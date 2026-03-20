/**
 * Safeway token extraction script (WebView only).
 * Injected into InAppBrowser via executeScript. Reads accessToken from
 * window.__injectedAccessToken (HttpOnly SWY_SHARED_SESSION via native bridge),
 * extracts clubCard from cookies/localStorage, then posts tokens via mobileApp.postMessage.
 * Receipt list/detail fetching runs in the app layer (safewayApiFetcher.js).
 */

/**
 * Returns the injection script as a string, called at bridge init.
 * @returns {string} IIFE script string for WebView injection
 */
export function getExtractScript() {
  return `
(function(){
  var BRIDGE_POLL=100,BRIDGE_MAX=20e3,TOKEN_POLL=400,TOKEN_MAX=60e3;

  function postDebug(msg,data){try{if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){window.mobileApp.postMessage(JSON.stringify({detail:{type:'safeway-webview-fetch-debug',message:msg,data:data||{}}}));}}catch(_){}}

  function postProgress(step,current,total){try{if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){window.mobileApp.postMessage(JSON.stringify({detail:{type:'safeway-progress',step:step,current:current||0,total:total||0}}));}}catch(_){}}

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
    var v;
    var names=['ACI_S_abs_previouslogin','SWY_SHARED_SESSION_INFO'];
    for(var i=0;i<names.length;i++){
      v=getCookie(names[i]);
      if(v){try{var j=JSON.parse(v);var c=j&&j.info&&j.info.COMMON&&j.info.COMMON.clubCard;if(c)return String(c);}catch(_){}}
    }
    var lsKeys=['SWY_LOYALTY_ID','loyalty_id','loyaltyId','clubCard','clubcard','SWY_CLUB_CARD'];
    var stores=[localStorage,sessionStorage];
    for(var si=0;si<stores.length;si++){
      try{for(var ki=0;ki<lsKeys.length;ki++){var val=stores[si].getItem(lsKeys[ki]);if(val&&/^\\d{7,}$/.test(val.trim()))return val.trim();}}catch(_){}
    }
    try{
      var raw=localStorage.getItem('SWY_SHARED_SESSION')||sessionStorage.getItem('SWY_SHARED_SESSION');
      if(raw){var j=JSON.parse(decodeURIComponent(raw));if(j&&j.clubCard)return String(j.clubCard);}
    }catch(_){}
    return null;
  }

  function getAccessToken(){
    return window.__injectedAccessToken||null;
  }

  function tryExtract(){
    var accessToken=getAccessToken();
    var clubCard=extractClubCard();
    postDebug('tryExtract',{hasToken:!!accessToken,hasClub:!!clubCard});
    if(!accessToken)return false;
    if(!clubCard){postTokens(accessToken,null);return true;}
    postDebug('tokens_ready',{hasToken:true,hasClub:true});
    postProgress('token_found',0,0);
    postTokens(accessToken,clubCard);
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
