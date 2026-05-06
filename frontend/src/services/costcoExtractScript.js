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

const RECEIPTS_QUERY =
  'query receiptsWithCounts($startDate: String!, $endDate: String!,$documentType:String!,$documentSubType:String!) { receiptsWithCounts(startDate: $startDate, endDate: $endDate,documentType:$documentType,documentSubType:$documentSubType) { inWarehouse gasStation carWash gasAndCarWash receipts{ warehouseName receiptType documentType transactionDateTime transactionBarcode transactionType total totalItemCount itemArray { itemNumber itemDescription01 itemDescription02 amount unit } tenderArray { tenderTypeCode tenderDescription amountTender } couponArray { upcnumberCoupon } } } }';

const WCS_CLIENT_ID = '4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf';
const CLIENT_IDENTIFIER = '481b1aec-aa3b-454b-b81b-48187e28f205';

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

  function isJwtExpired(token,bufferSec){
    try{
      var parts=token.split('.');
      if(parts.length!==3)return true;
      var b64=parts[1].replace(/-/g,'+').replace(/_/g,'/');
      var pad=b64.length%4;
      if(pad)b64+='===='.substring(0,pad);
      var payload=JSON.parse(atob(b64));
      if(!payload.exp)return true;
      return Date.now()/1000>=payload.exp-(bufferSec||60);
    }catch(_){return true;}
  }

  function jwtExpiresAtSec(token){
    try{
      var parts=token.split('.');
      if(parts.length!==3)return null;
      var b64=parts[1].replace(/-/g,'+').replace(/_/g,'/');
      var pad=b64.length%4;
      if(pad)b64+='===='.substring(0,pad);
      var payload=JSON.parse(atob(b64));
      return payload.exp!=null?payload.exp:null;
    }catch(_){return null;}
  }

  function findRT(st){try{for(var i=0;i<st.length;i++){var k=st.key(i);try{var val=JSON.parse(st.getItem(k));if(val&&val.credentialType==='RefreshToken'&&val.environment==='signin.costco.com')return{rt:val.secret,clientId:val.clientId||null};}catch(e){}}}catch(_){}return{rt:null,clientId:null};}
  function findIdToken(st){try{for(var i=0;i<st.length;i++){var k=st.key(i);try{var val=JSON.parse(st.getItem(k));if(val&&val.credentialType==='IdToken'&&val.environment==='signin.costco.com')return val.secret;}catch(e){}}}catch(_){}return null;}
  function findAccessToken(st){try{for(var i=0;i<st.length;i++){var k=st.key(i);try{var val=JSON.parse(st.getItem(k));if(val&&val.credentialType==='AccessToken'&&val.environment==='signin.costco.com')return val.secret;}catch(e){}}}catch(_){}return null;}

  function getBridge(){return window.__capgoBridge||window.mobileApp;}
  function postDebug(msg,data){try{var b=getBridge();if(b&&typeof b.postMessage==='function'){b.postMessage(JSON.stringify({detail:{type:'costco-webview-fetch-debug',message:msg,data:data||{}}}));}}catch(_){}}

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
    try{var b=getBridge();if(b&&typeof b.postMessage==='function'){
      window.__costcoReceiptsPosted=true;
      var token=accT||idT;
      var payload=JSON.stringify({detail:{type:'costco-receipts',receipts:receipts||[],idToken:token||idT,accessToken:accT||null,clientID:c,wcsClientId:wcsCid,refreshToken:rt,refreshTokenClientId:rtCid,userAgent:userAgent||(navigator.userAgent||'')}});
      b.postMessage(payload);
      return true;
    }}catch(_){}
    return false;
  }

  function postTokens(idT,accT,c,userAgent,rt,rtCid,wcsCid){
    if(window.__costcoReceiptsPosted)return true;
    try{var b=getBridge();if(b&&typeof b.postMessage==='function'){
      var token=accT||idT;
      var cid=c;
      var wcs=wcsCid||'${WCS_CLIENT_ID}';
      if(!token||token.length<50)return false;
      var payload=JSON.stringify({detail:{type:'costco-tokens',idToken:token||idT,accessToken:accT||null,clientID:cid,wcsClientId:wcs,capturedFromGraphQL:false,refreshToken:rt,refreshTokenClientId:rtCid,userAgent:userAgent||(navigator.userAgent||''),cookies:(document.cookie||'')}});
      b.postMessage(payload);
      return true;
    }}catch(_){}
    return false;
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
    var idT,accT; try{idT=findIdToken(localStorage);}catch(_){}
    if(!idT)try{idT=findIdToken(sessionStorage);}catch(_){}
    try{accT=findAccessToken(localStorage);}catch(_){}
    if(!accT)try{accT=findAccessToken(sessionStorage);}catch(_){}
    try{
      if(typeof window!=='undefined'){
        if(!window.__costcoTryPostTick)window.__costcoTryPostTick=0;
        window.__costcoTryPostTick++;
        var tick=window.__costcoTryPostTick;
        if(tick===1||tick===5||tick===25){
          var idPre=idT;
          var tickData={host:host,hasIdT:!!idT,hasAccT:!!accT,lsLen:localStorage.length,idExpired:!!(idPre&&isJwtExpired(idPre,60))};
          if(host==='www.costco.com'){
            var lsKeysFirst5=[];
            try{for(var li=0;li<Math.min(localStorage.length,5);li++){var lk=localStorage.key(li);if(lk)lsKeysFirst5.push(lk);}}catch(_){}
            tickData.lsKeysFirst5=lsKeysFirst5;
          }
          postDebug('tryPost-tick',tickData);
        }
      }
    }catch(_){}
    if(host!=='www.costco.com'&&host!=='costco.com'){return false;}
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

  function waitBridge(cb){var t0=Date.now();function check(){var b=getBridge();if(b&&typeof b.postMessage==='function'){cb();return;}if(Date.now()-t0>BRIDGE_MAX)return;setTimeout(check,BRIDGE_POLL);}check();}
  function pollTokens(){postDiag();var t0=Date.now(),iv=setInterval(function(){if(tryPost()){clearInterval(iv);if(typeof window!=='undefined')window.__costcoPollActive=false;return;}if(Date.now()-t0>TOKEN_MAX){clearInterval(iv);if(typeof window!=='undefined')window.__costcoPollActive=false;}},TOKEN_POLL);}
  if(typeof window!=='undefined'&&!window.__costcoPollActive){window.__costcoPollActive=true;waitBridge(pollTokens);}
})();
`;
}
