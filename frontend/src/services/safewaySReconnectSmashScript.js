/**
 * S-reconnect device-matrix smash script: wipes known Safeway session keys in page storage
 * and posts silentUnrecoverable. Injected via silentPreExtractVars only — never on login.
 */

const UNRECOVERABLE_TYPE = 'safeway-silent-unrecoverable';

/**
 * @returns {string} IIFE to inject into Safeway InAppBrowser before silent extract.
 */
export function getSafewaySReconnectSmashScript() {
  return `(function(){
  try{
    var host=typeof location!=='undefined'&&location.hostname?String(location.hostname).toLowerCase():'';
    if(host.indexOf('safeway.com')<0&&host.indexOf('albertsons')<0)return;
    function safeStore(getter){try{var s=getter();return s||null;}catch(_){return null;}}
    var wiped=0;
    var keys=['SWY_SHARED_SESSION','okta-token-storage'];
    function wipeStore(st){
      if(!st)return;
      for(var i=0;i<keys.length;i++){
        try{if(st.getItem(keys[i])!=null){st.removeItem(keys[i]);wiped++;}}catch(_){}
      }
    }
    wipeStore(safeStore(function(){return localStorage;}));
    wipeStore(safeStore(function(){return sessionStorage;}));
    window.__safewaySkipHttpOnlyInject=1;
    var smashNonce=typeof window.__mealdSyncNonce!=='undefined'?String(window.__mealdSyncNonce):'';
    if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){
      window.mobileApp.postMessage({detail:{type:'${UNRECOVERABLE_TYPE}',reason:'s_reconnect_smash',wiped:wiped,nonce:smashNonce.slice(0,8)}});
    }
  }catch(_){}
})();`;
}
