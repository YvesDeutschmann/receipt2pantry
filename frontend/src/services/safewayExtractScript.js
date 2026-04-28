/**
 * Safeway token extraction script (WebView only).
 * Injected into InAppBrowser via executeScript. Reads accessToken from multiple sources:
 * 1. window.__injectedAccessToken (HttpOnly SWY_SHARED_SESSION via native bridge — Android)
 * 2. JS-accessible SWY_SHARED_SESSION in localStorage/sessionStorage (iOS fallback)
 * 3. Okta token storage (okta-token-storage key — Albertsons SSO, iOS fallback)
 * 4. localStorage scan for any Okta/OIDC key containing a JWT accessToken
 * Extracts clubCard from cookies/localStorage, then posts tokens via mobileApp.postMessage.
 * Receipt list/detail fetching runs in the app layer (safewayApiFetcher.js).
 *
 * Diagnostics ride exclusively over `mobileApp.postMessage` (native bridge, CSP-immune).
 * Safeway sets a meta CSP whose `default-src` excludes `http:` — `fetch('http://localhost…')`
 * from inside the page is silently blocked, so we MUST NOT rely on fetch for telemetry.
 *
 * On iOS WKWebView, `about:blank` is an opaque origin — touching `localStorage` at the global
 * getter throws SecurityError. Never reference localStorage/sessionStorage without safeStore().
 */

/**
 * Returns the injection script as a string, called at bridge init.
 * @returns {string} IIFE script string for WebView injection
 */
export function getExtractScript() {
  return `
(function(){
  var BRIDGE_POLL=100,BRIDGE_MAX=20e3,TOKEN_POLL=400,TOKEN_MAX=60e3;

  // IMPORTANT (iOS): pass an OBJECT, not a JSON string. The iOS plugin casts
  // \`message.body as? [String: Any]\` — if it's a String the cast fails and the
  // event arrives as { rawMessage: '...' }, hiding type/payload. The Android
  // wrapper stringifies objects for us (\`typeof===string?message:JSON.stringify(message)\`).
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
  function postDebug(msg,data){postMsg('safeway-webview-fetch-debug',{message:msg,data:data||{}});}

  function safeStore(getter){try{var s=getter();return s||null;}catch(_){return null;}}
  function safeLsLength(ls){try{return ls.length;}catch(_){return 0;}}
  function safeLsKey(ls,i){try{return ls.key(i);}catch(_){return null;}}
  function safeGetItem(store,key){try{return store.getItem(key);}catch(_){return null;}}
  function storagePair(){
    var a=safeStore(function(){return localStorage;});
    var b=safeStore(function(){return sessionStorage;});
    var out=[];if(a)out.push(a);if(b)out.push(b);return out;
  }

  function currentHref(){try{return String(location.href||'');}catch(_){return '';}}
  function currentHost(){try{return String(location.hostname||'').toLowerCase();}catch(_){return '';}}
  function isOpaqueOrigin(){
    var h=currentHref();
    if(!h||h==='about:blank'||h.indexOf('about:blank')===0)return true;
    if(h.indexOf('about:')===0)return true;
    return false;
  }
  function isExtractableHost(){
    var host=currentHost();
    if(!host)return false;
    if(host.indexOf('safeway.com')>=0)return true;
    if(host.indexOf('albertsons')>=0)return true;
    return false;
  }

  // Heartbeat — fires on every executeScript invocation so the bridge can confirm the script
  // is actually executing on each page (independent of poll-loop / window-state).
  postDebug('script_run',{
    href:currentHref().slice(0,200),
    host:currentHost(),
    pollActive:!!window.__safewayPollActive,
    posted:!!window.__safewayPosted,
    hasMobileApp:!!(window.mobileApp&&window.mobileApp.postMessage),
    hasInjected:!!window.__injectedAccessToken
  });

  function postProgress(step,current,total){postMsg('safeway-progress',{step:step,current:current||0,total:total||0});}

  function postTokens(accessToken,clubCard){
    if(window.__safewayPosted)return true;
    if(!accessToken||accessToken.length<10)return false;
    if(!postMsg('safeway-tokens',{accessToken:accessToken,clubCard:clubCard||null}))return false;
    window.__safewayPosted=true;
    return true;
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
    var stores=storagePair();
    for(var si=0;si<stores.length;si++){
      try{for(var ki=0;ki<lsKeys.length;ki++){var val=safeGetItem(stores[si],lsKeys[ki]);if(val&&/^\\d{7,}$/.test(val.trim()))return val.trim();}}catch(_){}
    }
    try{
      var ls=safeStore(function(){return localStorage;});
      var ss=safeStore(function(){return sessionStorage;});
      var raw=safeGetItem(ls,'SWY_SHARED_SESSION')||(ss?safeGetItem(ss,'SWY_SHARED_SESSION'):null);
      if(raw){var j=JSON.parse(decodeURIComponent(raw));if(j&&j.clubCard)return String(j.clubCard);}
    }catch(_){}
    return null;
  }

  function getAccessToken(){
    if(window.__injectedAccessToken)return window.__injectedAccessToken;
    var token=null;
    try{
      var ls=safeStore(function(){return localStorage;});
      var ss=safeStore(function(){return sessionStorage;});
      var raw=safeGetItem(ls,'SWY_SHARED_SESSION')||(ss?safeGetItem(ss,'SWY_SHARED_SESSION'):null);
      if(raw){var j=JSON.parse(decodeURIComponent(raw));if(j&&j.accessToken&&j.accessToken.length>10)token=j.accessToken;}
    }catch(_){}
    if(token)return token;
    try{
      var ls2=safeStore(function(){return localStorage;});
      var okRaw=ls2?safeGetItem(ls2,'okta-token-storage'):null;
      var ok=JSON.parse(okRaw||'null');
      if(ok){var at=ok.accessToken;if(at&&typeof at.accessToken==='string'&&at.accessToken.length>10)token=at.accessToken;else if(at&&typeof at==='string'&&at.length>10)token=at;}
    }catch(_){}
    if(token)return token;
    try{
      var ls3=safeStore(function(){return localStorage;});
      if(!ls3)return null;
      var n=safeLsLength(ls3);
      for(var i=0;i<n;i++){
        var k=safeLsKey(ls3,i);if(!k)continue;
        if(k.indexOf('okta')!==-1||k.indexOf('token-storage')!==-1||k.indexOf('oidc')!==-1){
          try{
            var v=JSON.parse(safeGetItem(ls3,k)||'null');if(!v)continue;
            var t=v.accessToken;
            if(t&&typeof t.accessToken==='string'&&t.accessToken.startsWith('eyJ')&&t.accessToken.length>50){token=t.accessToken;break;}
            if(t&&typeof t==='string'&&t.startsWith('eyJ')&&t.length>50){token=t;break;}
          }catch(_){}
        }
      }
    }catch(_){}
    return token;
  }

  function describeTokenSources(){
    var out={injected:!!window.__injectedAccessToken,swyShared:false,oktaTokenStorage:false,oktaScanHits:0};
    try{
      var ls=safeStore(function(){return localStorage;});
      var ss=safeStore(function(){return sessionStorage;});
      var raw=safeGetItem(ls,'SWY_SHARED_SESSION')||(ss?safeGetItem(ss,'SWY_SHARED_SESSION'):null);
      if(raw){try{var j=JSON.parse(decodeURIComponent(raw));out.swyShared=!!(j&&j.accessToken);}catch(_){out.swyShared='unparseable';}}
    }catch(_){}
    try{
      var ls2=safeStore(function(){return localStorage;});
      var okRaw=ls2?safeGetItem(ls2,'okta-token-storage'):null;
      var ok=JSON.parse(okRaw||'null');
      if(ok){var at=ok.accessToken;out.oktaTokenStorage=!!(at&&((typeof at.accessToken==='string'&&at.accessToken.length>10)||(typeof at==='string'&&at.length>10)));}
    }catch(_){}
    try{
      var ls3=safeStore(function(){return localStorage;});
      if(ls3){var n=safeLsLength(ls3);for(var i=0;i<n;i++){var k=safeLsKey(ls3,i);if(!k)continue;if(k.indexOf('okta')!==-1||k.indexOf('token-storage')!==-1||k.indexOf('oidc')!==-1){out.oktaScanHits++;}}}
    }catch(_){}
    return out;
  }

  function tryExtract(){
    var accessToken=getAccessToken();
    var clubCard=extractClubCard();
    postDebug('tryExtract',{hasToken:!!accessToken,hasClub:!!clubCard,sources:describeTokenSources(),href:currentHref().slice(0,160)});
    if(!accessToken)return false;
    if(clubCard){
      postDebug('tokens_ready',{hasToken:true,hasClub:true});
      postProgress('token_found',0,0);
      return postTokens(accessToken,clubCard);
    }
    // No clubCard yet — keep polling for a bit, then post token-only as fallback so the bridge
    // can surface a useful error instead of silently stalling for the full login timeout.
    if(!window.__safewayClubWaitStart)window.__safewayClubWaitStart=Date.now();
    if(Date.now()-window.__safewayClubWaitStart>=8000){
      postDebug('tokens_ready_no_club',{hasToken:true,hasClub:false});
      postProgress('token_found',0,0);
      return postTokens(accessToken,null);
    }
    postDebug('waiting_for_clubcard',{href:currentHref().slice(0,160),sources:describeTokenSources()});
    return false;
  }

  function waitBridge(cb){
    var t0=Date.now();
    function check(){
      if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){cb();return;}
      if(Date.now()-t0>BRIDGE_MAX)return;
      setTimeout(check,BRIDGE_POLL);
    }
    check();
  }

  function pollToken(){
    var t0=Date.now();
    postDebug('pollToken_start',{sources:describeTokenSources(),href:currentHref().slice(0,160)});
    var iv=setInterval(function(){
      if(window.__safewayPosted){clearInterval(iv);window.__safewayPollActive=false;return;}
      if(tryExtract()){clearInterval(iv);window.__safewayPollActive=false;return;}
      if(Date.now()-t0>TOKEN_MAX){
        postDebug('pollToken_timeout',{sources:describeTokenSources(),href:currentHref().slice(0,160)});
        clearInterval(iv);window.__safewayPollActive=false;
      }
    },TOKEN_POLL);
  }

  // Already posted in this window context — nothing more to do this pass.
  if(window.__safewayPosted)return;

  // Try a synchronous extraction immediately if the bridge is ready and we are on a real page.
  // The bridge itself drives re-execution every ~3s, so even without our own poll loop we keep
  // trying. The poll loop below is a fast-path safety net for tokens that load asynchronously.
  if(isExtractableHost()&&window.mobileApp&&typeof window.mobileApp.postMessage==='function'){
    if(tryExtract())return;
  }

  // Don't start a per-window poll loop on opaque origins (about:blank) — localStorage is opaque
  // and the document will be replaced by the real page very shortly. The bridge will re-invoke us.
  if(isOpaqueOrigin())return;

  if(!isExtractableHost())return;

  if(!window.__safewayPollActive){
    window.__safewayPollActive=true;
    waitBridge(pollToken);
  }
})();
`;
}
