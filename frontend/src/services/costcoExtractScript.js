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
  function postDebug(msg,data){postMsg('costco-webview-fetch-debug',{message:msg,data:data||{}});}

  ${MSAL_CREDENTIAL_JS}

  if(!window.__costcoOpenWrapped){window.__costcoOpenWrapped=true;(function(){var origOpen=window.open;window.open=function(url,target,features){try{postDebug('window-open-intercepted',{url:String(url||'').slice(0,500),target:target||'',features:String(features||'').slice(0,200)});}catch(_){}return origOpen?origOpen.apply(this,arguments):null;};})();}

  function postDiag(){
    if(window.__costcoDiagPosted)return;
    window.__costcoDiagPosted=true;
    try{
      var lsKeys=[],ssKeys=[];
      try{for(var i=0;i<Math.min(localStorage.length,10);i++)lsKeys.push(localStorage.key(i));}catch(_){}
      try{for(var i=0;i<Math.min(sessionStorage.length,10);i++)ssKeys.push(sessionStorage.key(i));}catch(_){}
      postDebug('page-diagnostic',{
        href:location.href||'',
        title:document.title||'',
        lsLen:localStorage.length,lsKeys:lsKeys,
        ssLen:sessionStorage.length,ssKeys:ssKeys,
        bodyText:(document.body&&document.body.innerText||'').slice(0,300),
        hasWindowOpen:typeof window.open,
        ua:navigator.userAgent||''
      });
    }catch(_){}
  }

  function postReceiptsFromWebView(receipts,idT,accT,c,rt,rtCid,wcsCid,userAgent){
    if(window.__costcoReceiptsPosted)return true;
    var token=accT||idT;
    var ok=postMsg('costco-receipts',{receipts:receipts||[],idToken:token||idT,accessToken:accT||null,clientID:c,wcsClientId:wcsCid,refreshToken:rt,refreshTokenClientId:rtCid,userAgent:userAgent||(navigator.userAgent||'')});
    if(ok)window.__costcoReceiptsPosted=true;
    return ok;
  }

  function postTokens(idT,accT,c,userAgent,rt,rtCid,wcsCid){
    if(window.__costcoReceiptsPosted)return true;
    var token=accT||idT;
    var wcs=wcsCid||'${WCS_CLIENT_ID}';
    if(!token||token.length<50)return false;
    return postMsg('costco-tokens',{idToken:token||idT,accessToken:accT||null,clientID:c,wcsClientId:wcs,capturedFromGraphQL:false,refreshToken:rt,refreshTokenClientId:rtCid,userAgent:userAgent||(navigator.userAgent||''),cookies:(document.cookie||'')});
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
    if(window.__costcoFetchStarted)return;
    var token=accT||idT;
    var wcs=wcsCid||'${WCS_CLIENT_ID}';
    postDebug('fetchReceiptsInWebView',{tokenLen:(token||'').length,wcs:!!wcs,tokenExpired:!(token&&token.length>=50&&!isJwtExpired(token,60))});
    if(!token||token.length<50||isJwtExpired(token,60)){postDebug('fetchReceiptsInWebView skipped',{reason:'no valid token'});return;}
    doFetchReceipts({idT:idT,accT:accT,c:c,rt:rt,rtCid:rtCid,wcs:wcs,userAgent:userAgent||''});
  }

  function postMsalTokensDiag(idT,accT){
    postDebug('msal-tokens-found',{
      host:(typeof location!=='undefined'&&location.hostname)?location.hostname:'',
      idJwtExp:jwtExpiresAtSec(idT||''),
      accJwtExp:jwtExpiresAtSec(accT||''),
      idPreview:(idT||'').slice(0,36),
      ms:typeof Date!=='undefined'&&Date.now?Date.now():0
    });
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
    if(host!=='www.costco.com'&&host!=='costco.com'){return false;}
    var idT,accT; try{idT=findIdToken(localStorage);}catch(_){}
    if(!idT)try{idT=findIdToken(sessionStorage);}catch(_){}
    try{accT=findAccessToken(localStorage);}catch(_){}
    if(!accT)try{accT=findAccessToken(sessionStorage);}catch(_){}
    var c; try{c=localStorage.getItem('clientID')||localStorage.getItem('clientId')||sessionStorage.getItem('clientID')||sessionStorage.getItem('clientId')||null;}catch(_){c=null;}
    var r; try{r=findRT(localStorage);if(!r.rt)r=findRT(sessionStorage);}catch(_){r={rt:null,clientId:null};}
    if(idT&&isJwtExpired(idT,60))idT=null;
    if(accT&&isJwtExpired(accT,60))accT=null;
    if(!idT&&!accT)return false;
    postMsalTokensDiag(idT,accT);
    injectSyncOverlay();
    if(host==='www.costco.com'){fetchReceiptsInWebView(idT,accT,c,'${WCS_CLIENT_ID}',r.rt,r.clientId,navigator.userAgent||'');}
    else{postTokens(idT,accT,c,navigator.userAgent||'',r.rt,r.clientId,'${WCS_CLIENT_ID}');}
    return window.__costcoReceiptsPosted;
  }

  function waitBridge(cb){var t0=Date.now();function check(){if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){cb();return;}if(Date.now()-t0>BRIDGE_MAX)return;setTimeout(check,BRIDGE_POLL);}check();}
  function pollTokens(){postDiag();var t0=Date.now(),iv=setInterval(function(){if(tryPost()){clearInterval(iv);if(typeof window!=='undefined')window.__costcoPollActive=false;return;}if(Date.now()-t0>TOKEN_MAX){clearInterval(iv);if(typeof window!=='undefined')window.__costcoPollActive=false;}},TOKEN_POLL);}
  postDebug('script_run',{href:(location.href||'').slice(0,200),host:(location.hostname||'')});
  if(typeof window!=='undefined'&&!window.__costcoPollActive){window.__costcoPollActive=true;waitBridge(pollTokens);}
})();
`;
}
