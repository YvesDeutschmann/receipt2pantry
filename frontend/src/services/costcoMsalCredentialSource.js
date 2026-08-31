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

function jwtPayload(token){
  try{
    var parts=String(token||'').split('.');
    if(parts.length!==3)return null;
    var b64=parts[1].replace(/-/g,'+').replace(/_/g,'/');
    var pad=b64.length%4;
    if(pad)b64+='===='.substring(0,pad);
    return JSON.parse(atob(b64));
  }catch(_){return null;}
}

function jwtClaim(token,name){
  var p=jwtPayload(token);
  if(!p||name==null)return null;
  var v=p[name];
  return v!=null?String(v):null;
}

function jwtSecondsLeft(token,bufferSec){
  var exp=jwtExpiresAtSec(token);
  if(exp==null)return null;
  return Math.floor(exp-Date.now()/1000-(bufferSec||60));
}

function isUsableRtSecret(secret){
  if(!secret)return false;
  if(secret==='revoked'&&!(typeof window!=='undefined'&&window.__costcoS3ForceRefresh))return false;
  return true;
}

function isGuid(s){
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s||''));
}

function b2cAuthorityFromEntry(val){
  if(!val)return{tenant:null,policy:null};
  var hai=String(val.homeAccountId||'');
  var dot=hai.lastIndexOf('.');
  var tid=val.realm||(dot>0?hai.slice(dot+1):'');
  var uid=dot>0?hai.slice(0,dot):hai;
  var m=/-(b2c_1a_[a-z0-9_]+)$/i.exec(uid);
  return{
    tenant:isGuid(tid)?tid:null,
    policy:m?m[1].toLowerCase():null
  };
}

function findB2cAuthority(st){
  var best=null;
  try{
    for(var i=0;i<st.length;i++){
      try{
        var val=JSON.parse(st.getItem(st.key(i)));
        if(!val||val.environment!=='signin.costco.com')continue;
        var auth=b2cAuthorityFromEntry(val);
        if(auth.tenant&&auth.policy)return auth;
        if(auth.tenant&&!best)best={tenant:auth.tenant,policy:null};
      }catch(e){}
    }
  }catch(_){}
  return best;
}

function findB2cAuthorityAny(){
  var auth; try{auth=findB2cAuthority(localStorage);}catch(_){auth=null;}
  if(auth&&auth.tenant&&auth.policy)return auth;
  try{auth=findB2cAuthority(sessionStorage);}catch(_){auth=null;}
  if(auth&&auth.tenant&&auth.policy)return auth;
  try{
    var ls=findB2cAuthority(localStorage);
    var ss=findB2cAuthority(sessionStorage);
    if(ls&&ls.tenant)return ls;
    if(ss&&ss.tenant)return ss;
  }catch(_){}
  return{tenant:null,policy:null};
}

function findSigninIdTokenForEndpoint(st){
  try{
    for(var i=0;i<st.length;i++){
      try{
        var val=JSON.parse(st.getItem(st.key(i)));
        if(!val||val.credentialType!=='IdToken'||val.environment!=='signin.costco.com'||!val.secret)continue;
        var payload=jwtPayload(val.secret);
        if(payload&&String(payload.iss||'').indexOf('signin.costco.com')>=0)return val.secret;
      }catch(e){}
    }
  }catch(_){}
  return null;
}

function findSigninIdTokenForEndpointAny(){
  var t; try{t=findSigninIdTokenForEndpoint(localStorage);}catch(_){t=null;}
  if(t)return t;
  try{return findSigninIdTokenForEndpoint(sessionStorage);}catch(_){return null;}
}

function findRT(st){try{for(var i=0;i<st.length;i++){var k=st.key(i);try{var val=JSON.parse(st.getItem(k));if(val&&val.credentialType==='RefreshToken'&&val.environment==='signin.costco.com'&&isUsableRtSecret(val.secret))return{rt:val.secret,clientId:val.clientId||null,homeAccountId:val.homeAccountId||null};}catch(e){}}}catch(_){}return{rt:null,clientId:null,homeAccountId:null};}
function findRTWithKey(st){try{for(var i=0;i<st.length;i++){var k=st.key(i);try{var val=JSON.parse(st.getItem(k));if(val&&val.credentialType==='RefreshToken'&&val.environment==='signin.costco.com'&&isUsableRtSecret(val.secret))return{rt:val.secret,clientId:val.clientId||null,key:k,storage:st,homeAccountId:val.homeAccountId||null};}catch(e){}}}catch(_){}return{rt:null,clientId:null,key:null,storage:null,homeAccountId:null};}
function findExpiredIdToken(st){var best=null,bestExp=-1;try{for(var i=0;i<st.length;i++){var k=st.key(i);try{var val=JSON.parse(st.getItem(k));if(val&&val.credentialType==='IdToken'&&val.environment==='signin.costco.com'&&val.secret&&isJwtExpired(val.secret,60)){var exp=jwtExpiresAtSec(val.secret);if(exp!=null&&exp>bestExp){bestExp=exp;best=val.secret;}}}catch(e){}}}catch(_){}return best;}
function findAnySigninIdToken(st){try{for(var i=0;i<st.length;i++){var k=st.key(i);try{var val=JSON.parse(st.getItem(k));if(val&&val.credentialType==='IdToken'&&val.environment==='signin.costco.com'&&val.secret)return val.secret;}catch(e){}}}catch(_){}return null;}
function writeRotatedRT(entry,newSecret){try{if(!entry||!entry.key||!entry.storage||!newSecret)return false;var val=JSON.parse(entry.storage.getItem(entry.key));if(!val||val.credentialType!=='RefreshToken')return false;val.secret=newSecret;entry.storage.setItem(entry.key,JSON.stringify(val));return true;}catch(_){return false;}}
function findFreshCredential(st,credentialType){var best=null,bestExp=-1;try{for(var i=0;i<st.length;i++){var k=st.key(i);try{var val=JSON.parse(st.getItem(k));if(val&&val.credentialType===credentialType&&val.environment==='signin.costco.com'&&val.secret){if(isJwtExpired(val.secret,60))continue;var exp=jwtExpiresAtSec(val.secret);if(exp!=null&&exp>bestExp){bestExp=exp;best=val.secret;}}}catch(e){}}}catch(_){}return best;}
function findIdToken(st){return findFreshCredential(st,'IdToken');}
function findAccessToken(st){return findFreshCredential(st,'AccessToken');}
function credentialCensus(st){
  var seen=0,idTokens=0,accessTokens=0,refreshTokens=0,expired=0,unparseable=0,noSecret=0;
  var hasUsableRt=false,minSecondsLeft=null,maxSecondsLeft=null,tfp=null,bestIdExp=-1;
  var envMap={},now=Date.now()/1000;
  try{
    for(var i=0;i<st.length;i++){
      var k=st.key(i);
      try{
        var val=JSON.parse(st.getItem(k));
        if(!val||!val.credentialType)continue;
        seen++;
        var ct=val.credentialType;
        if(ct==='IdToken')idTokens++;
        else if(ct==='AccessToken')accessTokens++;
        else if(ct==='RefreshToken')refreshTokens++;
        if(val.environment)envMap[val.environment]=(envMap[val.environment]||0)+1;
        if(!val.secret){
          noSecret++;
        }else if(ct==='RefreshToken'){
          if(isUsableRtSecret(val.secret))hasUsableRt=true;
        }else{
          var exp=jwtExpiresAtSec(val.secret);
          if(exp==null){
            unparseable++;
          }else{
            var left=exp-now;
            if(left<=60)expired++;
            if(minSecondsLeft===null||left<minSecondsLeft)minSecondsLeft=left;
            if(maxSecondsLeft===null||left>maxSecondsLeft)maxSecondsLeft=left;
            if(ct==='IdToken'&&exp>bestIdExp){
              bestIdExp=exp;
              try{
                var parts=val.secret.split('.');
                var b64=parts[1].replace(/-/g,'+').replace(/_/g,'/');
                var pad=b64.length%4;
                if(pad)b64+='===='.substring(0,pad);
                var payload=JSON.parse(atob(b64));
                tfp=payload.tfp||payload.acr||null;
              }catch(_){}
            }
          }
        }
      }catch(e){}
    }
  }catch(_){}
  var envs=[];
  for(var e in envMap){if(Object.prototype.hasOwnProperty.call(envMap,e))envs.push(e);}
  return{
    seen:seen,
    idTokens:idTokens,
    accessTokens:accessTokens,
    refreshTokens:refreshTokens,
    environments:envs.join(','),
    expired:expired,
    unparseable:unparseable,
    noSecret:noSecret,
    hasUsableRt:hasUsableRt,
    minSecondsLeft:minSecondsLeft!=null?Math.floor(minSecondsLeft):null,
    maxSecondsLeft:maxSecondsLeft!=null?Math.floor(maxSecondsLeft):null,
    tfp:tfp
  };
}
`.trim();
