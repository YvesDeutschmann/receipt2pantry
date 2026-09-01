/**
 * S3 device-matrix smash script: revokes page MSAL RefreshToken in InAppBrowser storage.
 * Injected via silentPreExtractVars only — never on login extract.
 */

import { MSAL_CREDENTIAL_JS } from './costcoMsalCredentialSource';

const DEBUG_TYPE = 'costco-webview-fetch-debug';

/** Placeholder written into page MSAL RefreshToken.secret (matches inspect snippet). */
export const COSTCO_S3_RT_PLACEHOLDER = 'revoked';

function wrapProbe(inner) {
  return `(function(){\n${MSAL_CREDENTIAL_JS}\n${inner}\n})();`;
}

/**
 * @returns {string} IIFE to inject into Costco InAppBrowser before silent extract.
 */
export function getSmashRefreshTokenScript() {
  const placeholder = COSTCO_S3_RT_PLACEHOLDER;
  return wrapProbe(`
  try{
    var host=typeof location!=='undefined'&&location.hostname?location.hostname:'';
    if(host!=='www.costco.com'&&host!=='costco.com')return;
    var smashed=0;
    function smashStorage(st){
      try{
        for(var i=0;i<st.length;i++){
          var k=st.key(i);
          try{
            var v=JSON.parse(st.getItem(k));
            if(v&&v.credentialType==='RefreshToken'&&v.environment==='signin.costco.com'){
              v.secret='${placeholder}';
              st.setItem(k,JSON.stringify(v));
              smashed++;
            }
          }catch(e){}
        }
      }catch(_){}
    }
    smashStorage(localStorage);
    smashStorage(sessionStorage);
    window.__costcoS3ForceRefresh=true;
    var smashNonce=typeof window.__mealdSyncNonce!=='undefined'?String(window.__mealdSyncNonce):'';
    if(window.__costcoS3SmashNonce!==smashNonce){
      window.__costcoS3SmashNonce=smashNonce;
      window.__costcoRtRefreshStarted=false;
      window.__costcoRtRefreshAttempts=0;
      window.__costcoRtRefreshBackoffUntil=0;
      window.__costcoUnrecoverablePosted=false;
      window.__costcoFetchStarted=false;
    }
    if(window.__costcoS3SmashPostedNonce!==smashNonce){
      if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){
        window.mobileApp.postMessage({detail:{type:'${DEBUG_TYPE}',message:'diag-checkpoint',data:{
          checkpoint:'s3-smash-rt',
          smashed:smashed,
          lsLen:localStorage.length,
          nonce:smashNonce.slice(0,8)
        }}});
        window.__costcoS3SmashPostedNonce=smashNonce;
      }
    }
  }catch(_){}
  `);
}
