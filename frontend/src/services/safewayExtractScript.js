/**
 * Safeway token extraction and receipt fetch script.
 * Injected into WebView via executeScript. Reads accessToken injected from the
 * HttpOnly SWY_SHARED_SESSION cookie (window.__injectedAccessToken), extracts
 * clubCard from non-HttpOnly cookies or localStorage, then fetches receipts via
 * the Safeway instore API and posts them via mobileApp.postMessage.
 *
 * API endpoint: POST https://www.safeway.com/order-account/api/instore
 * - List:   { params: { clubcard, "client-section": "purchase" }, token, banner: "safeway" }
 * - Detail: { params: { clubcard, id: receiptId }, token, banner: "safeway" }
 */

const INSTORE_URL = 'https://www.safeway.com/order-account/api/instore';

/**
 * Returns the injection script as a string, called at bridge init.
 * @returns {string} IIFE script string for WebView injection
 */
export function getExtractScript() {
  return `
(function(){
  var BRIDGE_POLL=100,BRIDGE_MAX=20e3,TOKEN_POLL=400,TOKEN_MAX=60e3;
  var INSTORE_URL='${INSTORE_URL}';

  function postDebug(msg,data){try{if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){window.mobileApp.postMessage(JSON.stringify({detail:{type:'safeway-webview-fetch-debug',message:msg,data:data||{}}}));}}catch(_){}}

  function postProgress(step,current,total){try{if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){window.mobileApp.postMessage(JSON.stringify({detail:{type:'safeway-progress',step:step,current:current||0,total:total||0}}));}}catch(_){}}

  function postReceipts(receipts,accessToken,clubCard){
    if(window.__safewayPosted)return true;
    try{if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){
      window.__safewayPosted=true;
      window.mobileApp.postMessage(JSON.stringify({detail:{type:'safeway-receipts',receipts:receipts||[],accessToken:accessToken||null,clubCard:clubCard||null}}));
      return true;
    }}catch(_){}
    return false;
  }

  function postTokens(accessToken,clubCard){
    if(window.__safewayPosted)return true;
    try{if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){
      if(!accessToken||accessToken.length<10)return false;
      window.__safewayPosted=true;
      window.mobileApp.postMessage(JSON.stringify({detail:{type:'safeway-tokens',accessToken:accessToken||null,clubCard:clubCard||null}}));
      return true;
    }}catch(_){}
    return false;
  }

  function getCookie(name){
    try{var m=document.cookie.match(new RegExp('(?:^|; )'+name+'=([^;]*)'));return m?decodeURIComponent(m[1]):null;}catch(_){return null;}
  }

  function extractClubCard(){
    // Try non-HttpOnly cookies
    var v;
    var names=['ACI_S_abs_previouslogin','SWY_SHARED_SESSION_INFO'];
    for(var i=0;i<names.length;i++){
      v=getCookie(names[i]);
      if(v){try{var j=JSON.parse(v);var c=j&&j.info&&j.info.COMMON&&j.info.COMMON.clubCard;if(c)return String(c);}catch(_){}}
    }
    // Try localStorage / sessionStorage keys
    var lsKeys=['SWY_LOYALTY_ID','loyalty_id','loyaltyId','clubCard','clubcard','SWY_CLUB_CARD'];
    var stores=[localStorage,sessionStorage];
    for(var si=0;si<stores.length;si++){
      try{for(var ki=0;ki<lsKeys.length;ki++){var val=stores[si].getItem(lsKeys[ki]);if(val&&/^\\d{7,}$/.test(val.trim()))return val.trim();}}catch(_){}
    }
    // Try SWY_SHARED_SESSION localStorage (sometimes stored there too)
    try{
      var raw=localStorage.getItem('SWY_SHARED_SESSION')||sessionStorage.getItem('SWY_SHARED_SESSION');
      if(raw){var j=JSON.parse(decodeURIComponent(raw));if(j&&j.clubCard)return String(j.clubCard);}
    }catch(_){}
    return null;
  }

  function getAccessToken(){
    return window.__injectedAccessToken||null;
  }

  function parseReceiptList(data){
    if(!data||typeof data!=='object')return[];
    var list=data.receipts||data.purchaseHistory||data.orders;
    if(!list&&data.data&&typeof data.data==='object'){list=data.data.receipts||data.data.purchaseHistory||data.data.orders;}
    return Array.isArray(list)?list:[];
  }

  function fetchInstore(payload,cb){
    var headers={'content-type':'text/plain;charset=UTF-8','accept':'*/*','origin':'https://www.safeway.com','referer':'https://www.safeway.com/order-account/orders'};
    window.fetch(INSTORE_URL,{method:'POST',headers:headers,body:JSON.stringify(payload),credentials:'include'})
      .then(function(r){return r.json().then(function(d){cb(null,r.status,d);}).catch(function(){cb(null,r.status,{});});})
      .catch(function(e){cb(e,0,{});});
  }

  function doFetch(accessToken,clubCard){
    if(window.__safewayFetchStarted)return;
    window.__safewayFetchStarted=true;

    var knownIds=window.__knownOrderIds||[];
    var daysBack=window.__safewayDaysOverride||7;
    postDebug('doFetch start',{clubCard:!!clubCard,daysBack:daysBack,knownIds:knownIds.length});

    var listPayload={params:{clubcard:clubCard,'client-section':'purchase'},token:accessToken,banner:'safeway'};

    fetchInstore(listPayload,function(err,status,data){
      if(err||status!==200){
        postDebug('list fetch error',{err:String(err),status:status});
        // Fallback: no client-section
        var fb={params:{clubcard:clubCard},token:accessToken,banner:'safeway'};
        fetchInstore(fb,function(err2,s2,d2){
          if(err2||s2!==200){postDebug('fallback list error',{status:s2});postTokens(accessToken,clubCard);return;}
          processReceiptList(d2,accessToken,clubCard);
        });
        return;
      }
      var list=parseReceiptList(data);
      if(!list.length){
        // Fallback: no client-section
        var fb2={params:{clubcard:clubCard},token:accessToken,banner:'safeway'};
        fetchInstore(fb2,function(err3,s3,d3){
          if(err3||s3!==200||!parseReceiptList(d3).length){postDebug('no receipts found',{status:s3});postTokens(accessToken,clubCard);return;}
          processReceiptList(d3,accessToken,clubCard);
        });
        return;
      }
      processReceiptList(data,accessToken,clubCard);
    });
  }

  function processReceiptList(data,accessToken,clubCard){
    var list=parseReceiptList(data);
    postDebug('receipt list',{count:list.length});

    // Filter by daysBack and known order IDs
    var daysBack=window.__safewayDaysOverride||7;
    var knownIds=window.__knownOrderIds||[];
    var cutoff=Date.now()-daysBack*24*60*60*1000;
    var filtered=list.filter(function(r){
      var id=r._id||r.id||r.transactionId||'';
      if(knownIds.length&&id&&knownIds.indexOf(String(id))>=0)return false;
      var dt=r.posDateTime||r.date||'';
      if(dt){try{var t=new Date(dt).getTime();if(t<cutoff)return false;}catch(_){}}
      return true;
    });
    postDebug('filtered receipts',{total:list.length,filtered:filtered.length});

    if(!filtered.length){postReceipts([],accessToken,clubCard);return;}

    var results=[];
    var remaining=filtered.length;
    postProgress('fetching',0,filtered.length);

    filtered.forEach(function(summary,idx){
      var receiptId=summary._id||summary.id||'';
      if(!receiptId){
        results.push(summary);
        remaining--;
        postProgress('fetching',filtered.length-remaining,filtered.length);
        if(!remaining)postReceipts(results,accessToken,clubCard);
        return;
      }
      var detailPayload={params:{clubcard:clubCard,id:receiptId},token:accessToken,banner:'safeway'};
      fetchInstore(detailPayload,function(err,status,detail){
        if(err||status!==200||!detail||typeof detail!=='object'){
          postDebug('detail fetch fail',{id:receiptId,status:status});
          results.push(summary);
        } else {
          // Merge summary into detail for fallback fields
          results.push(Object.assign({},summary,detail));
        }
        remaining--;
        postProgress('fetching',filtered.length-remaining,filtered.length);
        if(!remaining)postReceipts(results,accessToken,clubCard);
      });
    });
  }

  function tryExtract(){
    var accessToken=getAccessToken();
    var clubCard=extractClubCard();
    postDebug('tryExtract',{hasToken:!!accessToken,hasClub:!!clubCard});
    if(!accessToken)return false;
    if(!clubCard){postTokens(accessToken,null);return true;}
    doFetch(accessToken,clubCard);
    return true;
  }

  function waitBridge(cb){var t0=Date.now();function check(){if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){cb();return;}if(Date.now()-t0>BRIDGE_MAX)return;setTimeout(check,BRIDGE_POLL);}check();}

  function pollToken(){
    var t0=Date.now();
    var iv=setInterval(function(){
      if(tryExtract()){clearInterval(iv);window.__safewayPollActive=false;return;}
      if(Date.now()-t0>TOKEN_MAX){clearInterval(iv);window.__safewayPollActive=false;}
    },TOKEN_POLL);
  }

  if(typeof window!=='undefined'&&!window.__safewayPollActive&&!window.__safewayPosted){
    window.__safewayPollActive=true;
    waitBridge(pollToken);
  }
})();
`;
}
