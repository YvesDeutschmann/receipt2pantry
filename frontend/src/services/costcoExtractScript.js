/**
 * Costco token extraction and receipt fetch script.
 * Injected into WebView via preShowScript. Polls localStorage for MSAL tokens,
 * constructs GraphQL headers, fetches receipts in-WebView, posts via mobileApp.postMessage.
 *
 * The `client-identifier` header is a static value from Costco's Contentstack CMS.
 * It can be verified/updated by querying (requires CONTENTSTACK_ACCESS_TOKEN from env):
 *
 *   POST https://azure-na-graphql.contentstack.com/stacks/bltc822c5b479075ef1?environment=production
 *   Headers: access_token: <token>, content-type: application/json
 *   Body: {"query":"query MyQuery($locale:String!){all_Configuration_Setting(locale:$locale where:{enabled_applications:{applications:\"my.costco.web\"}}){items{title configkey custom}}}","variables":{"locale":"prod"}}
 *
 * Look for `configkey: "site_context"` → custom.usbc.clientIdentifier
 */

import { MSAL_CREDENTIAL_JS } from './costcoMsalCredentialSource';
import {
  COSTCO_B2C_TENANT,
  COSTCO_B2C_POLICY_FALLBACK,
  COSTCO_B2C_CLIENT_ID,
} from './costcoB2cConfig';

const RECEIPTS_QUERY =
  'query receiptsWithCounts($startDate: String!, $endDate: String!,$documentType:String!,$documentSubType:String!) { receiptsWithCounts(startDate: $startDate, endDate: $endDate,documentType:$documentType,documentSubType:$documentSubType) { inWarehouse gasStation carWash gasAndCarWash receipts{ warehouseName receiptType documentType transactionDateTime transactionBarcode transactionType total totalItemCount itemArray { itemNumber itemDescription01 itemDescription02 amount unit } tenderArray { tenderTypeCode tenderDescription amountTender } couponArray { upcnumberCoupon } } } }';

const WCS_CLIENT_ID = '4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf';
const CLIENT_IDENTIFIER = '481b1aec-aa3b-454b-b81b-48187e28f205';

/**
 * Read-only login diagnostic script (UA, lsKeys, cookie names). Safe on signin/OTP hosts.
 * @returns {string} IIFE script string for WebView injection
 */
export function getDiagnosticScript() {
  return `
(function(){
  try{
    var host=typeof location!=='undefined'&&location.hostname?location.hostname:'';
    if(!window.__costcoLoginDiagHosts)window.__costcoLoginDiagHosts={};
    if(window.__costcoLoginDiagHosts[host])return;
    window.__costcoLoginDiagHosts[host]=true;
    var lsKeys=[],cookieNames=[];
    try{for(var i=0;i<Math.min(localStorage.length,12);i++){var k=localStorage.key(i);if(k)lsKeys.push(k);}}catch(_){}
    try{cookieNames=(document.cookie||'').split(';').map(function(s){return s.trim().split('=')[0];}).filter(Boolean).slice(0,20);}catch(_){}
    var payload={host:host,ua:navigator.userAgent||'',lsLen:localStorage.length,lsKeys:lsKeys,cookieNames:cookieNames,href:(location.href||'').slice(0,200)};
    if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){
      window.mobileApp.postMessage({detail:{type:'costco-webview-fetch-debug',message:'login-diagnostic',data:payload}});
    }
  }catch(_){}
})();
`;
}

/**
 * Returns the injection script as a string. Called at build/runtime with the GraphQL URL.
 * @param {string} graphqlUrl - Costco GraphQL endpoint URL
 * @returns {string} IIFE script string for WebView injection
 */
export function getExtractScript(graphqlUrl) {
  const escapedQuery = RECEIPTS_QUERY.replace(/'/g, "\\'");
  return `
(function(){
  var TOKEN_POLL=400,TOKEN_MAX=3e5,BRIDGE_POLL=100,BRIDGE_MAX=20e3;
  var GRAPHQL_URL='${graphqlUrl}';
  var CLIENT_ID='${CLIENT_IDENTIFIER}';
  var B2C_TENANT='${COSTCO_B2C_TENANT}';
  var B2C_POLICY_FALLBACK='${COSTCO_B2C_POLICY_FALLBACK}';
  var B2C_CLIENT_ID='${COSTCO_B2C_CLIENT_ID}';

  // iOS InAppBrowser: pass an OBJECT to postMessage, not JSON.stringify (Safeway pattern).
  function postMsg(type,payload){
    try{
      if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){
        var detail={type:type};
        if(payload){for(var k in payload){if(Object.prototype.hasOwnProperty.call(payload,k))detail[k]=payload[k];}}
        window.mobileApp.postMessage({detail:detail});
        return true;
      }
    }catch(_){}
    return false;
  }
  function postDebug(msg,data){return postMsg('costco-webview-fetch-debug',{message:msg,data:data||{}});}

  function traceTryPostBranch(branch){
    if(!window.__mealdTryPostTrace)return;
    var prev=window.__mealdTryPostTraceLast||'';
    if(prev===branch)return;
    if(postDebug('tryPost-branch',{branch:branch}))window.__mealdTryPostTraceLast=branch;
  }

  function resetCostcoSessionIfNonceChanged(){
    var nonce=typeof window!=='undefined'&&window.__mealdSyncNonce!=null?String(window.__mealdSyncNonce):'';
    var seen=typeof window!=='undefined'&&window.__mealdSyncNonceSeen!=null?String(window.__mealdSyncNonceSeen):'';
    if(!nonce||nonce===seen)return false;
    window.__mealdSyncNonceSeen=nonce;
    if(window.__costcoPollIv){try{clearInterval(window.__costcoPollIv);}catch(_){}}
    window.__costcoPollIv=null;
    window.__costcoPollActive=false;
    window.__costcoRtRefreshStarted=false;
    window.__costcoUnrecoverablePosted=false;
    window.__costcoAppRefreshRequested=false;
    window.__costcoFetchStarted=false;
    window.__costcoReceiptsPosted=false;
    window.__costcoRtRefreshAttempts=0;
    window.__costcoRtRefreshBackoffUntil=0;
    window.__costcoDiagCount=0;
    window.__costcoDiagLastMs=0;
    window.__costcoCensusCount=0;
    window.__costcoCensusLastMs=0;
    window.__costcoMissStreak=0;
    window.__costcoMissLastMs=0;
    return true;
  }

  ${MSAL_CREDENTIAL_JS}

  if(!window.__costcoOpenWrapped){window.__costcoOpenWrapped=true;(function(){var origOpen=window.open;window.open=function(url,target,features){try{postDebug('window-open-intercepted',{url:String(url||'').slice(0,500),target:target||'',features:String(features||'').slice(0,200)});}catch(_){}return origOpen?origOpen.apply(this,arguments):null;};})();}

  function postDiag(){
    var now=Date.now();
    var count=window.__costcoDiagCount||0;
    var last=window.__costcoDiagLastMs||0;
    if(count>=8)return;
    if(count>0&&now-last<3000)return;
    try{
      var lsKeys=[],ssKeys=[],lsCap=Math.min(localStorage.length,60),ssCap=Math.min(sessionStorage.length,60),ki;
      try{for(ki=0;ki<lsCap;ki++){var lk=localStorage.key(ki);if(lk)lsKeys.push(String(lk).slice(0,120));}}catch(_){}
      try{for(ki=0;ki<ssCap;ki++){var sk=sessionStorage.key(ki);if(sk)ssKeys.push(String(sk).slice(0,120));}}catch(_){}
      var ok=postDebug('page-diagnostic',{
        href:location.href||'',
        title:document.title||'',
        lsLen:localStorage.length,lsKeys:lsKeys,
        ssLen:sessionStorage.length,ssKeys:ssKeys,
        bodyText:(document.body&&document.body.innerText||'').slice(0,300),
        hasWindowOpen:typeof window.open,
        ua:navigator.userAgent||''
      });
      if(ok){
        window.__costcoDiagCount=count+1;
        window.__costcoDiagLastMs=now;
      }
    }catch(_){}
  }

  function hasSigninEnv(st){
    try{
      for(var i=0;i<st.length;i++){
        try{
          var k=st.key(i);
          var val=JSON.parse(st.getItem(k));
          if(val&&val.credentialType&&val.environment==='signin.costco.com')return true;
        }catch(e){}
      }
    }catch(_){}
    return false;
  }
  function hasExpiredSigninIdToken(st){
    try{
      for(var i=0;i<st.length;i++){
        try{
          var k=st.key(i);
          var val=JSON.parse(st.getItem(k));
          if(val&&val.credentialType==='IdToken'&&val.environment==='signin.costco.com'&&val.secret&&isJwtExpired(val.secret,60))return true;
        }catch(e){}
      }
    }catch(_){}
    return false;
  }
  function hasFreshAccessToken(st){
    try{
      for(var i=0;i<st.length;i++){
        try{
          var k=st.key(i);
          var val=JSON.parse(st.getItem(k));
          if(val&&val.credentialType==='AccessToken'&&val.environment==='signin.costco.com'&&val.secret&&!isJwtExpired(val.secret,60))return true;
        }catch(e){}
      }
    }catch(_){}
    return false;
  }
  function classifyMsalMissReason(){
    var ls=credentialCensus(localStorage);
    var ss=credentialCensus(sessionStorage);
    var seen=ls.seen+ss.seen;
    if(seen===0)return 'no_msal_entries';
    if(!hasSigninEnv(localStorage)&&!hasSigninEnv(sessionStorage))return 'env_mismatch';
    var hasRt=ls.hasUsableRt||ss.hasUsableRt;
    var freshAcc=hasFreshAccessToken(localStorage)||hasFreshAccessToken(sessionStorage);
    var expiredId=hasExpiredSigninIdToken(localStorage)||hasExpiredSigninIdToken(sessionStorage);
    if(expiredId&&hasRt&&!freshAcc)return 'expired_id_rt_present';
    var unparse=ls.unparseable+ss.unparseable;
    if(unparse>0&&unparse>=seen)return 'unparseable';
    if((ls.expired+ss.expired)>=seen&&!hasRt)return 'all_expired';
    return 'unknown';
  }
  function postMsalCensusMiss(){
    var now=Date.now();
    var count=window.__costcoCensusCount||0;
    var last=window.__costcoCensusLastMs||0;
    if(count>=8){traceTryPostBranch('census_capped');return;}
    if(count>0&&now-last<3000)return;
    var ls=credentialCensus(localStorage);
    var ss=credentialCensus(sessionStorage);
    var tfc=null;
    try{tfc=sessionStorage.getItem('getTokenFailureCount');}catch(_){}
    var ok=postDebug('msal-census',{
      reason:classifyMsalMissReason(),
      tokenFailureCount:tfc,
      ls:ls,
      ss:ss
    });
    if(ok){
      window.__costcoCensusCount=count+1;
      window.__costcoCensusLastMs=now;
      traceTryPostBranch('census_posted');
    }
  }

  function postReceiptsFromWebView(receipts,idT,accT,c,rt,rtCid,wcsCid,userAgent){
    if(window.__costcoReceiptsPosted)return true;
    var token=accT||idT;
    var safeRt=rt&&rt!=='revoked'?rt:null;
    var ok=postMsg('costco-receipts',{receipts:receipts||[],idToken:token||idT,accessToken:accT||null,clientID:c,wcsClientId:wcsCid,refreshToken:safeRt,refreshTokenClientId:rtCid,userAgent:userAgent||(navigator.userAgent||'')});
    if(ok)window.__costcoReceiptsPosted=true;
    return ok;
  }

  function postTokens(idT,accT,c,userAgent,rt,rtCid,wcsCid){
    if(window.__costcoReceiptsPosted)return true;
    var token=accT||idT;
    var wcs=wcsCid||'${WCS_CLIENT_ID}';
    if(!token||token.length<50)return false;
    var safeRt=rt&&rt!=='revoked'?rt:null;
    return postMsg('costco-tokens',{idToken:token||idT,accessToken:accT||null,clientID:c,wcsClientId:wcs,capturedFromGraphQL:false,refreshToken:safeRt,refreshTokenClientId:rtCid,userAgent:userAgent||(navigator.userAgent||''),cookies:(document.cookie||'')});
  }

  function doFetchReceipts(tokens){
    if(window.__costcoFetchStarted)return;
    window.__costcoFetchStarted=true;
    var idT=tokens.idT,accT=tokens.accT,c=tokens.c,rt=tokens.rt,rtCid=tokens.rtCid,wcs=tokens.wcs,userAgent=tokens.userAgent;
    var token=accT||idT;
    postDebug('doFetchReceipts entry',{tokenLen:(token||'').length,cid:CLIENT_ID,wcs:!!wcs});
    var endD=new Date(),startD=new Date();
    startD.setDate(startD.getDate()-90);
    var startStr=(String(startD.getMonth()+1).padStart(2,'0')+'/'+String(startD.getDate()).padStart(2,'0')+'/'+startD.getFullYear());
    var endStr=(String(endD.getMonth()+1).padStart(2,'0')+'/'+String(endD.getDate()).padStart(2,'0')+'/'+endD.getFullYear());
    var body=JSON.stringify({query:'${escapedQuery}',variables:{startDate:startStr,endDate:endStr,text:'Last 3 Months',documentType:'all',documentSubType:'all'}});
    var headers={'Accept':'*/*','Accept-Language':'en-US,en;q=0.9,de-DE;q=0.8,de;q=0.7','Content-Type':'application/json-patch+json','Origin':'https://www.costco.com','Referer':'https://www.costco.com/','Sec-Fetch-Dest':'empty','Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-site','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','client-identifier':CLIENT_ID,'costco-x-authorization':'Bearer '+token,'costco-x-wcs-clientId':wcs,'costco.env':'ecom','costco.service':'restOrders','sec-ch-ua':'"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"','sec-ch-ua-mobile':'?0','sec-ch-ua-platform':'"Windows"'};
    postDebug('doFetchReceipts headers',{headerKeys:Object.keys(headers)});
    window.fetch(GRAPHQL_URL,{method:'POST',headers:headers,body:body,credentials:'omit'}).then(function(r){
      postDebug('doFetchReceipts response',{status:r.status,ok:r.ok,contentType:(r.headers.get('content-type')||'').slice(0,50)});
      return r.json().then(function(data){
        if(r.ok&&data&&data.data&&data.data.receiptsWithCounts){var raw=data.data.receiptsWithCounts.receipts;if(Array.isArray(raw)){postDebug('doFetchReceipts success',{receiptCount:raw.length});postReceiptsFromWebView(raw,idT,accT,c,rt,rtCid,wcs,userAgent);return;}}
        postDebug('doFetchReceipts fallback to postTokens',{status:r.status,bodyPreview:(JSON.stringify(data)||'').slice(0,500)});
        postTokens(idT,accT,c,userAgent,rt,rtCid,wcs);
      }).catch(function(parseErr){
        postDebug('doFetchReceipts parse error',{error:String(parseErr&&parseErr.message||parseErr),status:r.status});
        postTokens(idT,accT,c,userAgent,rt,rtCid,wcs);
      });
    }).catch(function(netErr){
      postDebug('doFetchReceipts network error',{error:String(netErr&&netErr.message||netErr)});
      postTokens(idT,accT,c,userAgent,rt,rtCid,wcs);
    });
  }

  function fetchReceiptsInWebView(idT,accT,c,wcsCid,rt,rtCid,userAgent){
    if(window.__costcoFetchStarted){traceTryPostBranch('fetch_latched');return;}
    var token=accT||idT;
    var wcs=wcsCid||'${WCS_CLIENT_ID}';
    postDebug('fetchReceiptsInWebView',{tokenLen:(token||'').length,wcs:!!wcs,tokenExpired:!(token&&token.length>=50&&!isJwtExpired(token,60))});
    if(!token||token.length<50||isJwtExpired(token,60)){postDebug('fetchReceiptsInWebView skipped',{reason:'no valid token'});return;}
    doFetchReceipts({idT:idT,accT:accT,c:c,rt:rt,rtCid:rtCid,wcs:wcs,userAgent:userAgent||''});
  }

  function postMsalTokensDiag(idT,accT,r){
    var rt=r&&r.rt;
    postDebug('msal-tokens-found',{
      host:(typeof location!=='undefined'&&location.hostname)?location.hostname:'',
      tfp:jwtClaim(idT,'tfp')||jwtClaim(idT,'acr')||'',
      idSecondsLeft:idT?jwtSecondsLeft(idT,60):null,
      accSecondsLeft:accT?jwtSecondsLeft(accT,60):null,
      hasAccess:!!accT,
      hasRt:!!rt
    });
  }

  function b2cPolicyFromPayload(payload){
    if(!payload)return B2C_POLICY_FALLBACK;
    var raw=payload.tfp||payload.acr||B2C_POLICY_FALLBACK;
    var policy=String(raw).toLowerCase();
    if(/^[a-z0-9_-]{1,128}$/.test(policy))return policy;
    return B2C_POLICY_FALLBACK;
  }

  function resolveB2cTokenEndpoint(idToken,msalAuth){
    var policy=B2C_POLICY_FALLBACK;
    var tenant=B2C_TENANT;
    var authoritySource='fallback';
    try{
      var payload=jwtPayload(idToken);
      var iss=String(payload&&payload.iss||'');
      if(payload&&iss.indexOf('signin.costco.com')>=0){
        policy=b2cPolicyFromPayload(payload);
        if(iss.indexOf('signin.costco.com')>=0){
          var parts=iss.replace(/\\/$/,'').split('/');
          if(parts.length>1&&parts[parts.length-1]==='v2.0')tenant=parts[parts.length-2]||tenant;
          else if(parts.length>0)tenant=parts[parts.length-1]||tenant;
        }
        authoritySource='iss';
      }else if(msalAuth&&msalAuth.tenant){
        tenant=msalAuth.tenant;
        if(msalAuth.policy)policy=msalAuth.policy;
        authoritySource='msal';
      }
    }catch(_){
      if(msalAuth&&msalAuth.tenant){
        tenant=msalAuth.tenant;
        if(msalAuth.policy)policy=msalAuth.policy;
        authoritySource='msal';
      }
    }
  var endpoint='https://signin.costco.com/'+tenant+'/'+policy+'/oauth2/v2.0/token';
  return{endpoint:endpoint,policy:policy,tenant:tenant,authoritySource:authoritySource};
  }

  function buildB2cTokenEndpoint(idToken,msalAuth){
    return resolveB2cTokenEndpoint(idToken,msalAuth).endpoint;
  }

  function postTokenRotated(idT,rt,rtCid,c){
    postMsg('costco-token-rotated',{
      idToken:idT,
      accessToken:null,
      clientID:c,
      wcsClientId:'${WCS_CLIENT_ID}',
      refreshToken:rt,
      refreshTokenClientId:rtCid,
      userAgent:navigator.userAgent||''
    });
  }

  function postSilentUnrecoverable(reason){
    if(window.__costcoUnrecoverablePosted)return;
    if(postMsg('costco-silent-unrecoverable',{reason:String(reason||'unknown').slice(0,120)})){
      window.__costcoUnrecoverablePosted=true;
    }
  }

  function postAppRefreshRequest(){
    if(window.__costcoAppRefreshRequested)return;
    if(postMsg('costco-app-refresh-request',{})){
      window.__costcoAppRefreshRequested=true;
    }
  }

  function shouldDeclareUnrecoverable(){
    var now=Date.now();
    var streak=window.__costcoMissStreak||0;
    var last=window.__costcoMissLastMs||0;
    if(streak===0){
      window.__costcoMissStreak=1;
      window.__costcoMissLastMs=now;
      return false;
    }
    if(now-last>=6000)return true;
    try{if(document.readyState==='complete')return true;}catch(_){}
    window.__costcoMissStreak=streak+1;
    window.__costcoMissLastMs=now;
    return streak>=1&&(now-last)>=3000;
  }

  function tryRefreshWithRt(expiredId,rEntry,c,msalAuth){
    var now=Date.now();
    if(window.__costcoRtRefreshBackoffUntil&&now<window.__costcoRtRefreshBackoffUntil){traceTryPostBranch('refresh_backoff');return true;}
    var attempts=window.__costcoRtRefreshAttempts||0;
    if(attempts>=3){
      postSilentUnrecoverable('refresh_http_exhausted');
      traceTryPostBranch('refresh_exhausted');
      return true;
    }
    if(window.__costcoRtRefreshStarted){traceTryPostBranch('refresh_latched');return true;}
    window.__costcoRtRefreshStarted=true;
    traceTryPostBranch('refresh_started');
    var resolved=resolveB2cTokenEndpoint(expiredId,msalAuth);
    var endpoint=resolved.endpoint;
    var policy=resolved.policy;
    var tenantPrefix=String(resolved.tenant||'').slice(0,8);
    var authoritySource=resolved.authoritySource;
    var clientId=rEntry.clientId||B2C_CLIENT_ID;
    var attemptNum=attempts+1;
    postDebug('rt-refresh-start',{policy:policy,tenant:tenantPrefix,authoritySource:authoritySource,attempt:attemptNum,source:'page'});
    var body='grant_type='+encodeURIComponent('refresh_token')+
      '&client_id='+encodeURIComponent(clientId)+
      '&refresh_token='+encodeURIComponent(rEntry.rt)+
      '&scope='+encodeURIComponent('openid offline_access '+clientId);
    window.fetch(endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':navigator.userAgent||''},
      body:body,
      credentials:'omit'
    }).then(function(resp){
      return resp.text().then(function(text){
        var data={};
        try{data=JSON.parse(text);}catch(_){}
        var rotated=!!(data&&data.refresh_token);
        var hasNewId=!!(data&&data.id_token);
        var errCode=data&&data.error?String(data.error):'';
        var contentType='';
        try{contentType=String(resp.headers&&resp.headers.get('content-type')||'').slice(0,50);}catch(_){}
        var bodyPreview=String(text||'').slice(0,120);
        postDebug('rt-refresh-result',{
          status:resp.status,
          cors:false,
          errorCode:errCode.slice(0,80),
          policy:policy,
          tenant:tenantPrefix,
          authoritySource:authoritySource,
          attempt:attemptNum,
          contentType:contentType,
          bodyPreview:bodyPreview,
          hasNewId:hasNewId,
          rotated:rotated,
          source:'page'
        });
        if(resp.status===200&&data.id_token){
          if(isJwtExpired(data.id_token,60)){
            postSilentUnrecoverable('refresh_clock_skew');
            return;
          }
          window.__costcoRtRefreshAttempts=0;
          window.__costcoRtRefreshBackoffUntil=0;
          var newRt=data.refresh_token||rEntry.rt;
          writeRotatedRT(rEntry,newRt);
          postTokenRotated(data.id_token,newRt,rEntry.clientId,c);
          injectSyncOverlay();
          doFetchReceipts({idT:data.id_token,accT:null,c:c,rt:newRt,rtCid:rEntry.clientId,wcs:'${WCS_CLIENT_ID}',userAgent:navigator.userAgent||''});
          return;
        }
        if(errCode==='invalid_grant'||errCode==='interaction_required'||errCode==='login_required'){
          postSilentUnrecoverable('refresh_'+errCode);
          return;
        }
        if(resp.status>=400&&resp.status<500){
          postSilentUnrecoverable('refresh_http_'+resp.status);
          return;
        }
        window.__costcoRtRefreshStarted=false;
        window.__costcoRtRefreshAttempts=attemptNum;
        var backoffMs=attemptNum===1?1000:attemptNum===2?3000:8000;
        window.__costcoRtRefreshBackoffUntil=Date.now()+backoffMs;
      });
    }).catch(function(err){
      var msg=String(err&&err.message||err||'');
      var isCors=msg.indexOf('Failed to fetch')>=0||msg.indexOf('NetworkError')>=0;
      window.__costcoRtRefreshStarted=false;
      window.__costcoRtRefreshAttempts=attemptNum;
      var backoffMs=attemptNum===1?1000:attemptNum===2?3000:8000;
      window.__costcoRtRefreshBackoffUntil=Date.now()+backoffMs;
      postDebug('rt-refresh-result',{
        status:0,
        cors:isCors,
        errorCode:isCors?'cors':'network',
        policy:policy,
        tenant:tenantPrefix,
        authoritySource:authoritySource,
        attempt:attemptNum,
        hasNewId:false,
        rotated:false,
        source:'page'
      });
      if(isCors){
        if(!window.__costcoS3ForceRefresh)postAppRefreshRequest();
        return;
      }
      if(attemptNum>=3)postSilentUnrecoverable('refresh_network_exhausted');
    });
    return true;
  }

  function injectSyncOverlay(){
    try{
      if(document.getElementById('meald-sync-style'))return;
      var s=document.createElement('style');
      s.id='meald-sync-style';
      s.textContent=
        'body::before{content:"";position:fixed;inset:0;background:#fff;z-index:2147483646;}'+
        'body::after{content:"Syncing Costco Receipts";position:fixed;top:50%;left:50%;'+
        'transform:translate(-50%,-50%);z-index:2147483647;'+
        'font:600 20px/1 sans-serif;color:#333;white-space:nowrap;}';
      (document.head||document.documentElement).appendChild(s);
    }catch(_){}
  }

  function tryPost(){
    var host=typeof location!=='undefined'&&location.hostname?location.hostname:'';
    if(host!=='www.costco.com'&&host!=='costco.com'){traceTryPostBranch('host_mismatch');return false;}
    var forceRefresh=!!window.__costcoS3ForceRefresh;
    var liveIdForRefresh=null;
    var idT,accT; try{idT=findIdToken(localStorage);}catch(_){}
    if(!idT)try{idT=findIdToken(sessionStorage);}catch(_){}
    try{accT=findAccessToken(localStorage);}catch(_){}
    if(!accT)try{accT=findAccessToken(sessionStorage);}catch(_){}
    if(forceRefresh){
      liveIdForRefresh=idT||accT;
      idT=null;
      accT=null;
    }
    var c; try{c=localStorage.getItem('clientID')||localStorage.getItem('clientId')||sessionStorage.getItem('clientID')||sessionStorage.getItem('clientId')||null;}catch(_){c=null;}
    var r; try{r=findRT(localStorage);if(!r.rt)r=findRT(sessionStorage);}catch(_){r={rt:null,clientId:null};}
    if(!idT&&!accT&&window.__mealdInjectedIdToken&&!isJwtExpired(window.__mealdInjectedIdToken,60)){
      idT=window.__mealdInjectedIdToken;
    }
    if(idT&&isJwtExpired(idT,60))idT=null;
    if(accT&&isJwtExpired(accT,60))accT=null;
    if(!idT&&!accT){
      var rEntry; try{rEntry=findRTWithKey(localStorage);if(!rEntry.rt)rEntry=findRTWithKey(sessionStorage);}catch(_){rEntry={rt:null,clientId:null,key:null,storage:null,homeAccountId:null};}
      var msalAuth=findB2cAuthorityAny();
      if(rEntry.homeAccountId){
        var rtAuth=b2cAuthorityFromEntry({homeAccountId:rEntry.homeAccountId,realm:null});
        if(rtAuth.tenant){
          if(!msalAuth||!msalAuth.tenant)msalAuth=rtAuth;
          else if(!msalAuth.policy&&rtAuth.policy)msalAuth.policy=rtAuth.policy;
        }
      }
      var expiredId; try{expiredId=findExpiredIdToken(localStorage);if(!expiredId)expiredId=findExpiredIdToken(sessionStorage);}catch(_){expiredId=null;}
      if(forceRefresh&&liveIdForRefresh)expiredId=liveIdForRefresh;
      if(!expiredId){
        try{expiredId=findSigninIdTokenForEndpointAny();}catch(_){expiredId=null;}
      }
      if(rEntry.rt){
        if(tryRefreshWithRt(expiredId||'',rEntry,c,msalAuth))return false;
      }
      postMsalCensusMiss();
      if(shouldDeclareUnrecoverable()){
        var missReason=classifyMsalMissReason();
        if(!forceRefresh&&missReason==='expired_id_rt_present'&&!rEntry.rt)postAppRefreshRequest();
        else if(missReason!=='expired_id_rt_present')postSilentUnrecoverable(missReason);
      }
      return false;
    }
    traceTryPostBranch('tokens_found');
    postMsalTokensDiag(idT,accT,r);
    injectSyncOverlay();
    if(host==='www.costco.com'){fetchReceiptsInWebView(idT,accT,c,'${WCS_CLIENT_ID}',r.rt,r.clientId,navigator.userAgent||'');}
    else{postTokens(idT,accT,c,navigator.userAgent||'',r.rt,r.clientId,'${WCS_CLIENT_ID}');}
    return window.__costcoReceiptsPosted;
  }

  function waitBridge(cb){var t0=Date.now();function check(){if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){cb();return;}if(Date.now()-t0>BRIDGE_MAX)return;setTimeout(check,BRIDGE_POLL);}check();}
  function pollTokens(){postDiag();var t0=Date.now(),iv=setInterval(function(){postDiag();if(typeof window.__costcoSweepResourceTiming==='function')window.__costcoSweepResourceTiming();if(tryPost()){clearInterval(iv);window.__costcoPollIv=null;if(typeof window!=='undefined')window.__costcoPollActive=false;return;}if(Date.now()-t0>TOKEN_MAX){clearInterval(iv);window.__costcoPollIv=null;if(typeof window!=='undefined')window.__costcoPollActive=false;}},TOKEN_POLL);window.__costcoPollIv=iv;}
  var sessionReset=resetCostcoSessionIfNonceChanged();
  var nonceTag=typeof window.__mealdSyncNonce!=='undefined'?String(window.__mealdSyncNonce).slice(0,8):'';
  postDebug('script_run',{href:(location.href||'').slice(0,200),host:(location.hostname||''),nonce:nonceTag,reset:sessionReset});
  if(typeof window!=='undefined'&&!window.__costcoPollActive){window.__costcoPollActive=true;waitBridge(pollTokens);}
})();
`;
}
