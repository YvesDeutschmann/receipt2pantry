/**
 * Single source of truth for MSAL credential selection logic embedded in the Costco
 * WebView inject script. ES5-only (var, atob, JSON, Date) — no imports.
 * Imported by costcoExtractScript.js (string embed) and costcoMsalTokenHelpers.js (tests).
 */

export const MSAL_CREDENTIAL_JS = `
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
function findFreshCredential(st,credentialType){var best=null,bestExp=-1;try{for(var i=0;i<st.length;i++){var k=st.key(i);try{var val=JSON.parse(st.getItem(k));if(val&&val.credentialType===credentialType&&val.environment==='signin.costco.com'&&val.secret){if(isJwtExpired(val.secret,60))continue;var exp=jwtExpiresAtSec(val.secret);if(exp!=null&&exp>bestExp){bestExp=exp;best=val.secret;}}}catch(e){}}}catch(_){}return best;}
function findIdToken(st){return findFreshCredential(st,'IdToken');}
function findAccessToken(st){return findFreshCredential(st,'AccessToken');}
`.trim();
