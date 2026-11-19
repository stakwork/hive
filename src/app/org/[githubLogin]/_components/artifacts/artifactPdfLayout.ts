/**
 * The pure parts of the HTML → PDF path: how a tall page is cut into A4
 * pages and captured in canvas-sized chunks, and the snapshot bridge's
 * message and script. No DOM, no jspdf — so they can be tested alone.
 */

export const A4_W_MM = 210;
export const A4_H_MM = 297;

export const SNAPSHOT_MESSAGE = "hive-pdf-snapshot";
export const SNAPSHOT_REQUEST = "hive-pdf-snapshot-request";

/** Browsers refuse canvases much past this on one side. */
export const MAX_CANVAS_PX = 16000;
/** A page taller than this is cut off rather than held in memory. */
export const MAX_PAGE_HEIGHT_PX = 150_000;

export interface Range {
  top: number;
  height: number;
}

/** The height of one A4 page, in the page's own pixels, when the page is `width` wide. */
export const pageHeightPx = (width: number): number => (width * A4_H_MM) / A4_W_MM;

/** The A4 pages a page `height` tall is cut into, top to bottom; the last may be short. Always at least one. */
export function pageRanges(height: number, width: number): Range[] {
  const total = Math.min(Math.max(1, Math.ceil(height)), MAX_PAGE_HEIGHT_PX);
  const step = pageHeightPx(width);
  const out: Range[] = [];
  for (let top = 0; top < total - 0.5; top += step) out.push({ top, height: Math.min(step, total - top) });
  return out;
}

export interface CapturePlan {
  scale: number;
  /** Vertical windows to capture, each a whole number of pages so no page spans two. */
  chunks: Range[];
}

/**
 * How to capture a page at a readable scale: 2x normally, 1.5x for a very long page,
 * in windows that each fit a canvas, rather than shrinking the whole page into one.
 */
export function capturePlan(height: number, width: number, maxCanvasPx = MAX_CANVAS_PX): CapturePlan {
  const pages = pageRanges(height, width);
  const scale = pages.length > 20 ? 1.5 : 2;
  const perChunk = Math.max(1, Math.floor(maxCanvasPx / scale / pageHeightPx(width)));
  const chunks: Range[] = [];
  for (let i = 0; i < pages.length; i += perChunk) {
    const group = pages.slice(i, i + perChunk);
    const last = group[group.length - 1];
    chunks.push({ top: group[0].top, height: last.top + last.height - group[0].top });
  }
  return { scale, chunks };
}

/** The index of the chunk a page lies in. */
export const chunkIndexOf = (plan: CapturePlan, page: Range): number =>
  Math.max(0, plan.chunks.findIndex((c) => page.top >= c.top - 0.5 && page.top < c.top + c.height - 0.5));

export interface Snapshot {
  html: string;
  width: number;
  height: number;
}

/** The snapshot a frame posted, or null for anything else — other messages, another frame's nonce, a malformed body. */
export function parseSnapshotMessage(data: unknown, nonce: string): Snapshot | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.type !== SNAPSHOT_MESSAGE || d.nonce !== nonce) return null;
  if (typeof d.html !== "string" || !d.html) return null;
  const width = typeof d.width === "number" && d.width > 0 ? d.width : 1024;
  const height = typeof d.height === "number" && d.height > 0 ? d.height : 0;
  return { html: d.html, width, height };
}

/**
 * The script that runs inside the page's own (opaque-origin) frame: after load, fonts and a
 * short settle — or when the parent asks — it posts the rendered DOM as static HTML.
 */
export function snapshotScriptSource(nonce: string, settleMs = 800): string {
  return `(function(){
var NONCE=${JSON.stringify(nonce)},sent=false;
function snap(){
  var root=document.documentElement,clone=root.cloneNode(true);
  try{
    var src=root.querySelectorAll("canvas"),dst=clone.querySelectorAll("canvas");
    for(var i=0;i<src.length&&i<dst.length;i++){
      try{var url=src[i].toDataURL("image/png");
        var img=document.createElement("img");img.src=url;
        img.width=src[i].width;img.height=src[i].height;
        var cs=getComputedStyle(src[i]);img.style.cssText=src[i].style.cssText;
        if(!img.style.width)img.style.width=cs.width;if(!img.style.height)img.style.height=cs.height;
        img.className=src[i].className;if(src[i].id)img.id=src[i].id;
        dst[i].parentNode.replaceChild(img,dst[i]);}catch(e){}
    }
    var fs=root.querySelectorAll("input,textarea,select"),fd=clone.querySelectorAll("input,textarea,select");
    for(var j=0;j<fs.length&&j<fd.length;j++){
      var a=fs[j],b=fd[j];
      if(a.tagName==="TEXTAREA"){b.textContent=a.value;}
      else if(a.tagName==="SELECT"){for(var k=0;k<a.options.length;k++){if(a.options[k].selected)b.options[k].setAttribute("selected","");else b.options[k].removeAttribute("selected");}}
      else if(a.type==="checkbox"||a.type==="radio"){if(a.checked)b.setAttribute("checked","");else b.removeAttribute("checked");}
      else{b.setAttribute("value",a.value);}
    }
  }catch(e){}
  var scripts=clone.querySelectorAll("script");
  for(var s=0;s<scripts.length;s++)scripts[s].parentNode.removeChild(scripts[s]);
  var metas=clone.querySelectorAll('meta[http-equiv]');
  for(var m=0;m<metas.length;m++)if(/content-security-policy/i.test(metas[m].getAttribute("http-equiv")))metas[m].parentNode.removeChild(metas[m]);
  var body=document.body;
  var w=Math.max(root.scrollWidth,body?body.scrollWidth:0),h=Math.max(root.scrollHeight,body?body.scrollHeight:0);
  parent.postMessage({type:${JSON.stringify(SNAPSHOT_MESSAGE)},nonce:NONCE,html:"<!DOCTYPE html>"+clone.outerHTML,width:w,height:h},"*");
}
function auto(){if(sent)return;sent=true;snap();}
window.addEventListener("message",function(e){
  var d=e.data;
  if(e.source===parent&&d&&d.type===${JSON.stringify(SNAPSHOT_REQUEST)}&&d.nonce===NONCE){sent=true;snap();}
});
function settle(){var f=document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve();
  f.then(function(){setTimeout(auto,${Math.round(settleMs)});},function(){setTimeout(auto,${Math.round(settleMs)});});}
if(document.readyState==="complete")settle();else window.addEventListener("load",settle);
})();`;
}

/** The page with the snapshot script added at the end of its body. */
export function injectSnapshotScript(html: string, nonce: string): string {
  const tag = `<script>${snapshotScriptSource(nonce).replace(/<\/script/gi, "<\\/script")}</script>`;
  const at = html.toLowerCase().lastIndexOf("</body>");
  return at === -1 ? html + tag : html.slice(0, at) + tag + html.slice(at);
}
