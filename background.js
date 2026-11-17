(function QuettaBG(){
  "use strict";
  chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL("viewer.html")}));
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    const action=msg?.action;
    if(action==="scanningComplete"){chrome.tabs.create({url:chrome.runtime.getURL("viewer.html")});reply({success:true});return true;}
    if(action==="openHistoryPage"){chrome.tabs.create({url:"https://myactivity.google.com/page?hl=en&page=youtube_comments"});reply({success:true});return true;}
    if(!["fetchLikesForComments","validateApiKey","getChannelInfo"].includes(action))return false;
    (async()=>{
      try{
        if(action==="getChannelInfo"){reply({success:true,userName:"You"});return;}
        if(action==="validateApiKey"){
          const key=String(msg.key||"").trim();
          if(!key)throw Error("API key is empty");
          await youtube("videos",{part:"id",id:"jNQXAC9IVRw"},key);
          reply({success:true});return;
        }
        const key=String((await chrome.storage.local.get("youtubeApiKey")).youtubeApiKey||"").trim();
        if(!key)throw Error("Save a YouTube Data API key before fetching likes.");
        reply({success:true,comments:await fetchLikes(msg.comments||[],key)});
      }catch(e){console.error("[Quetta] "+action,e?.message||e);reply({success:false,error:e?.message||String(e)});}
    })();return true;
  });
  async function youtube(path,params,key){
    const u=new URL("https://www.googleapis.com/youtube/v3/"+path);
    for(const [p,v] of Object.entries(params))if(v!==null&&v!==undefined&&v!=="")u.searchParams.set(p,String(v));
    u.searchParams.set("key",key);
    const r=await fetch(u,{headers:{Accept:"application/json"}});
    const body=await r.json().catch(()=>({}));
    if(!r.ok){
      const err=new Error("YouTube API HTTP "+r.status+": "+(body?.error?.message||r.statusText));
      err.status=r.status;
      err.reason=body?.error?.errors?.[0]?.reason||body?.error?.status||"";
      throw err;
    }
    return body;
  }
  // 403 can mean quota or an invalid API key: those must remain visible failures.
  function isBlockingError(e){
    const reason=String(e?.reason||"").toLowerCase();
    const message=String(e?.message||"").toLowerCase();
    return /quota|rate.?limit|daily.?limit|accessnotconfigured|api.?key|keyinvalid|keyexpired|referer|not been used|not enabled|not allowed|project.?blocked|requests? (?:from|are) blocked|billing/i.test(reason+" "+message);
  }
  function isSkippable(e){
    return (e?.status===403||e?.status===404) && !isBlockingError(e);
  }
  function norm(s){return String(s||"").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g," ").trim();}
  async function byIds(ids,key){
    if(!ids.length)return [];
    try{return (await youtube("comments",{part:"snippet",id:ids.join(","),textFormat:"plainText"},key)).items||[];}
    catch(e){
      if(e?.status===400||isSkippable(e)){
        if(ids.length===1){
          console.info("[Quetta] Skip unavailable comment ID; HTTP",e.status);
          return [];
        }
        const n=ids.length>>>1;
        return [...await byIds(ids.slice(0,n),key),...await byIds(ids.slice(n),key)];
      }
      throw e;
    }
  }
  async function byPublicVideo(videoId,unresolved,key){
    const found=new Map();
    const pending=new Set(unresolved.filter(c=>norm(c.text).length>=8));
    if(!pending.size)return found;
    let token="";
    for(let i=0;i<10&&pending.size;i++){
      let body;
      try{body=await youtube("commentThreads",{part:"snippet,replies",videoId,maxResults:100,order:"time",textFormat:"plainText",pageToken:token},key);}
      catch(e){
        if(isSkippable(e)){
          console.info("[Quetta] Skip unavailable video:",videoId,"HTTP",e.status);
          break;
        }
        throw e;
      }
      for(const th of body.items||[]){
        const cand=[];
        const top=th?.snippet?.topLevelComment;
        if(top?.snippet)cand.push(["comment",top]);
        for(const r of th?.replies?.comments||[])if(r?.snippet)cand.push(["reply",r]);
        for(const [type,item] of cand)for(const c of [...pending]){
          const targetType=c.activityType==="reply"?"reply":"comment";
          const s=item.snippet.textOriginal||item.snippet.textDisplay||"";
          if(type===targetType&&norm(c.text)===norm(s)){
            found.set(c,item);pending.delete(c);
          }
        }
      }
      token=body.nextPageToken||"";
      if(!token)break;
    }
    return found;
  }
  async function fetchLikes(comments,key){
    const variants=new Map(),idSet=new Set(),found=new Map();
    for(const c of comments){
      if(!c?.commentId)continue;
      const raw=String(c.commentId),candidates=[raw];
      const split=raw.split(".");
      if(split.length>1&&split[split.length-1]!==raw)candidates.push(split[split.length-1]);
      variants.set(c,candidates);for(const id of candidates)idSet.add(id);
    }
    const ids=[...idSet];
    for(let i=0;i<ids.length;i+=50)for(const item of await byIds(ids.slice(i,i+50),key))if(item?.id&&item?.snippet)found.set(item.id,item);
    const resolved=new Map();
    for(const c of comments){
      const v=(variants.get(c)||[]).map(id=>found.get(id)).find(Boolean);
      if(v)resolved.set(c,{...c,likes:v.snippet.likeCount??0,likeFetched:true,likeSource:"comment-id",lastLikeUpdate:Date.now()});
    }
    const groups=new Map();
    for(const c of comments)if(!resolved.has(c)&&/^[A-Za-z0-9_-]{11}$/.test(c?.videoId||"")){
      if(!groups.has(c.videoId))groups.set(c.videoId,[]);
      groups.get(c.videoId).push(c);
    }
    for(const [videoId,missing] of groups){
      const matches=await byPublicVideo(videoId,missing,key);
      for(const [c,item] of matches)resolved.set(c,{...c,likes:item.snippet.likeCount??0,likeFetched:true,likeSource:"public-text",lastLikeUpdate:Date.now()});
    }
    return comments.map(c=>resolved.get(c)||{...c,likeFetched:false});
  }
})();
