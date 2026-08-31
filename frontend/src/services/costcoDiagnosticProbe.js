/**
 * ES5 diagnostic scripts injected into the Costco InAppBrowser WebView.
 * Captures MSAL censuses, /token exchange metadata, and optional expired-only purge.
 */

import { MSAL_CREDENTIAL_JS } from './costcoMsalCredentialSource';

const DEBUG_TYPE = 'costco-webview-fetch-debug';

function wrapProbe(inner) {
  return `(function(){\n${MSAL_CREDENTIAL_JS}\n${inner}\n})();`;
}

/**
 * Installs fetch/XHR hooks, PerformanceObserver, and resource-timing sweep (once per page load).
 * @returns {string}
 */
export function getTokenWrapInstallScript() {
  return wrapProbe(`
  if(window.__costcoDiagProbePageKey===location.href.split('#')[0])return;
  window.__costcoDiagProbePageKey=location.href.split('#')[0];
  window.__costcoTokenExchangePosted=window.__costcoTokenExchangePosted||0;
  window.__costcoTokenSweepRuns=window.__costcoTokenSweepRuns||0;
  window.__costcoTokenSeen=window.__costcoTokenSeen||false;
  window.__costcoTokenSeenKeys=window.__costcoTokenSeenKeys||{};

  function policyFromUrl(u){
    try{
      var url=String(u||'');
      var m=url.match(/[?&]p=([^&]+)/i);
      if(m)return decodeURIComponent(m[1]).slice(0,120);
      var m2=url.match(/\\/b2c_1a_[^/?]+/i);
      if(m2)return m2[0].slice(0,120);
    }catch(_){}
    return '';
  }

  function postExchange(data){
    if(window.__costcoTokenExchangePosted>=4)return;
    if(data&&data.fired)window.__costcoTokenSeen=true;
    window.__costcoTokenExchangePosted+=1;
    try{
      if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){
        window.mobileApp.postMessage({detail:{type:'${DEBUG_TYPE}',message:'token-exchange',data:data||{}}});
      }
    }catch(_){}
  }

  function isTokenUrl(u){return String(u||'').indexOf('/oauth2/v2.0/token')>=0;}

  function recordTokenExchange(evt){
    var key='';
    if(evt&&evt.timingKey)key=String(evt.timingKey);
    else if(evt)key=String(evt.source||'')+'|'+(evt.status||0)+'|'+(evt.policy||'');
    if(key&&window.__costcoTokenSeenKeys[key])return;
    if(key)window.__costcoTokenSeenKeys[key]=true;
    postExchange(evt);
  }

  try{
    if(typeof performance!=='undefined'&&typeof performance.setResourceTimingBufferSize==='function'){
      performance.setResourceTimingBufferSize(1000);
    }
  }catch(_){}

  try{
    if(typeof PerformanceObserver!=='undefined'){
      var perfObs=new PerformanceObserver(function(list){
        var entries=list.getEntries();
        for(var i=0;i<entries.length;i++){
          var e=entries[i];
          if(!e||!e.name||e.name.indexOf('/oauth2/v2.0/token')<0)continue;
          recordTokenExchange({
            source:'resource-timing',
            fired:true,
            status:e.responseStatus||0,
            policy:policyFromUrl(e.name),
            error:'',
            errorDescription:'',
            timingKey:e.name+'@'+(e.startTime||0)
          });
        }
      });
      perfObs.observe({type:'resource',buffered:true});
      window.__costcoPerfObserver=perfObs;
    }
  }catch(_){}

  if(typeof window.fetch==='function'&&!window.__costcoFetchWrapped){
    window.__costcoFetchWrapped=true;
    var origFetch=window.fetch;
    window.fetch=function(input,init){
      var url=typeof input==='string'?input:(input&&input.url?input.url:'');
      if(!isTokenUrl(url))return origFetch.apply(this,arguments);
      return origFetch.apply(this,arguments).then(function(resp){
        var status=resp.status;
        var policy=policyFromUrl(url);
        if(status>=200&&status<300){
          recordTokenExchange({source:'fetch',fired:true,status:status,policy:policy,error:'',errorDescription:'',timingKey:'fetch@'+url});
          return resp;
        }
        return resp.clone().json().then(function(j){
          recordTokenExchange({
            source:'fetch',
            fired:true,
            status:status,
            policy:policy,
            error:String(j&&j.error||'').slice(0,80),
            errorDescription:String(j&&j.error_description||'').slice(0,200),
            timingKey:'fetch@'+url+'@'+status
          });
          return resp;
        }).catch(function(){
          recordTokenExchange({source:'fetch',fired:true,status:status,policy:policy,error:'',errorDescription:'',timingKey:'fetch@'+url+'@'+status});
          return resp;
        });
      });
    };
  }

  if(window.XMLHttpRequest&&!window.__costcoXhrWrapped){
    window.__costcoXhrWrapped=true;
    var OrigXHR=window.XMLHttpRequest;
    window.XMLHttpRequest=function(){
      var xhr=new OrigXHR();
      var reqUrl='';
      var open=xhr.open;
      xhr.open=function(method,u){
        reqUrl=String(u||'');
        return open.apply(xhr,arguments);
      };
      xhr.addEventListener('load',function(){
        if(!isTokenUrl(reqUrl))return;
        var status=xhr.status||0;
        var policy=policyFromUrl(reqUrl);
        if(status>=200&&status<300){
          recordTokenExchange({source:'xhr',fired:true,status:status,policy:policy,error:'',errorDescription:'',timingKey:'xhr@'+reqUrl});
          return;
        }
        try{
          var j=JSON.parse(xhr.responseText||'{}');
          recordTokenExchange({
            source:'xhr',
            fired:true,
            status:status,
            policy:policy,
            error:String(j&&j.error||'').slice(0,80),
            errorDescription:String(j&&j.error_description||'').slice(0,200),
            timingKey:'xhr@'+reqUrl+'@'+status
          });
        }catch(_){
          recordTokenExchange({source:'xhr',fired:true,status:status,policy:policy,error:'',errorDescription:'',timingKey:'xhr@'+reqUrl+'@'+status});
        }
      });
      return xhr;
    };
    window.XMLHttpRequest.prototype=OrigXHR.prototype;
  }

  window.__costcoSweepResourceTiming=function(){
    window.__costcoTokenSweepRuns=(window.__costcoTokenSweepRuns||0)+1;
    try{
      var entries=performance.getEntriesByType('resource')||[];
      for(var i=0;i<entries.length;i++){
        var e=entries[i];
        if(!e||!e.name||e.name.indexOf('/oauth2/v2.0/token')<0)continue;
        recordTokenExchange({
          source:'resource-timing',
          fired:true,
          status:e.responseStatus||0,
          policy:policyFromUrl(e.name),
          error:'',
          errorDescription:'',
          timingKey:e.name+'@'+(e.startTime||0)
        });
      }
    }catch(_){}
  };
  `);
}

/**
 * Posts explicit missed verdict when no /token was observed (Run A negative).
 * @returns {string}
 */
export function getTokenVerdictScript() {
  return wrapProbe(`
  try{
    if(window.__costcoTokenVerdictPosted)return;
    window.__costcoTokenVerdictPosted=true;
    if(window.__costcoTokenSeen)return;
    var data={
      fired:false,
      source:'missed',
      status:0,
      policy:'',
      error:'',
      errorDescription:'',
      sweepRuns:window.__costcoTokenSweepRuns||0
    };
    if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){
      window.mobileApp.postMessage({detail:{type:'${DEBUG_TYPE}',message:'token-exchange',data:data}});
    }
  }catch(_){}
  `);
}

/**
 * @param {'a0'|'a1'|'a2'|string} checkpoint
 * @returns {string}
 */
export function getCheckpointEmitScript(checkpoint) {
  const cp = String(checkpoint).replace(/[^a-z0-9_-]/gi, '').slice(0, 20);
  return wrapProbe(`
  try{
    if(typeof window.__costcoSweepResourceTiming==='function')window.__costcoSweepResourceTiming();
    var ls=credentialCensus(localStorage);
    var ss=credentialCensus(sessionStorage);
    var tfc=null;
    try{tfc=sessionStorage.getItem('getTokenFailureCount');}catch(_){}
    var hashPresent=false;
    try{hashPresent=(location.hash||'').length>1;}catch(_){}
    var payload={
      checkpoint:'${cp}',
      href:(location.href||'').split('#')[0].slice(0,200),
      hashPresent:hashPresent,
      tokenFailureCount:tfc,
      lsLen:localStorage.length,
      ssLen:sessionStorage.length,
      ls:ls,
      ss:ss
    };
    if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){
      window.mobileApp.postMessage({detail:{type:'${DEBUG_TYPE}',message:'diag-checkpoint',data:payload}});
    }
  }catch(_){}
  `);
}

/**
 * Run B: delete expired IdToken/AccessToken only (never RefreshToken).
 * @returns {string}
 */
export function getPurgeExpiredScript() {
  return wrapProbe(`
  try{
    var now=Math.ceil(Date.now()/1000);
    function expiredSecret(s){
      try{
        var parts=String(s).split('.');
        if(parts.length!==3)return false;
        var b64=parts[1].replace(/-/g,'+').replace(/_/g,'/');
        var pad=b64.length%4;
        if(pad)b64+='===='.substring(0,pad);
        var p=JSON.parse(atob(b64));
        return typeof p.exp==='number'&&p.exp-now<=60;
      }catch(_){return false;}
    }
    var doomed=[];
    for(var i=0;i<localStorage.length;i++){
      var k=localStorage.key(i);
      var v;try{v=JSON.parse(localStorage.getItem(k));}catch(_){continue;}
      if(!v||(v.credentialType!=='IdToken'&&v.credentialType!=='AccessToken'))continue;
      if(v.secret&&expiredSecret(v.secret))doomed.push(k);
    }
    for(var j=0;j<doomed.length;j++)localStorage.removeItem(doomed[j]);
    if(window.mobileApp&&typeof window.mobileApp.postMessage==='function'){
      window.mobileApp.postMessage({detail:{type:'${DEBUG_TYPE}',message:'diag-checkpoint',data:{
        checkpoint:'purge-expired',
        removedCount:doomed.length,
        lsLen:localStorage.length
      }}});
    }
  }catch(_){}
  `);
}
