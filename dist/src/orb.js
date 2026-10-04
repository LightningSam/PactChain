// Procedural WebGL: rotating dark spheres around a luminous core. No model or texture assets.
const vertex = `attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}`;
const fragment = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform vec2 pointer;
uniform float hover;
uniform float scroll;
const int COUNT=15;
mat3 rotY(float a){return mat3(cos(a),0.,-sin(a),0.,1.,0.,sin(a),0.,cos(a));}
mat3 rotX(float a){return mat3(1.,0.,0.,0.,cos(a),sin(a),0.,-sin(a),cos(a));}
float hitSphere(vec3 ro,vec3 rd,vec3 c,float r){vec3 oc=ro-c;float b=dot(oc,rd);float h=b*b-dot(oc,oc)+r*r;if(h<0.)return 100.;float t=-b-sqrt(h);return t>0.?t:100.;}
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*resolution)/resolution.y;
 vec3 ro=vec3(0.,0.,7.5-hover*.12);vec3 rd=normalize(vec3(uv,-1.65));
 mat3 rotation=rotY(time*.13+pointer.x*.85+scroll*.45)*rotX(sin(time*.10)*.16+pointer.y*.55);
 float near=100.;vec3 center=vec3(0.);float radius=.82;bool core=true;
 near=hitSphere(ro,rd,center,radius);
 for(int i=0;i<COUNT;i++){
  float f=float(i);float y=1.-(f+.5)/float(COUNT)*2.;float radial=sqrt(1.-y*y);float a=f*2.399963;
  vec3 c=rotation*vec3(cos(a)*radial,y,sin(a)*radial)*1.20;
  float r=.34+.17*(.5+.5*sin(f*8.73));
  float h=hitSphere(ro,rd,c,r);
  if(h<near){near=h;center=c;radius=r;core=false;}
 }
 float glow=exp(-length(uv)*length(uv)*14.)*.06;
 vec3 color=vec3(1.,.96,.58)*glow;
 float alpha=glow*.9;
 if(near<99.){
  vec3 p=ro+rd*near;vec3 n=normalize(p-center);vec3 view=normalize(ro-p);
  if(core){
   float edge=pow(1.-max(dot(n,view),0.),2.);color=vec3(1.,.97,.60)*(1.-.15*edge);alpha=1.;
  }else{
   float ndv=max(dot(n,view),0.);
   float internal=max(dot(n,normalize(-p)),0.);
   float fresnel=pow(1.-ndv,3.);
   vec3 key=normalize(vec3(-3.+pointer.x*2.,4.-pointer.y*2.,4.)-p);
   float diffuse=max(dot(n,key),0.);
   float spec=pow(max(dot(n,normalize(key+view)),0.),40.);
   float reflected=pow(max(dot(n,normalize(normalize(-p)+view)),0.),6.);
   float nearCore=1./(1.+dot(p,p)*.8);
   color=vec3(.085,.089,.073)+vec3(.032,.032,.020)*diffuse;
   color+=vec3(1.,.96,.60)*(internal*.82*nearCore+fresnel*.15+reflected*.13*nearCore);
   color+=vec3(.65,.67,.52)*spec*.20;
   alpha=1.;
  }
 }
 float dither=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
 color+=(dither-.5)/180.;
 gl_FragColor=vec4(color,alpha);
}`;

export function initOrb(canvas,isPaused){
  const gl=canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:false,powerPreference:'low-power'});
  if(!gl){canvas.parentElement.classList.add('no-webgl');return;}
  const shader=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){gl.deleteShader(s);throw new Error('Orb shader compilation failed');}return s;};
  let program;
  try{
    program=gl.createProgram();
    gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Orb program linking failed');
  }catch{canvas.parentElement.classList.add('no-webgl');return;}
  gl.useProgram(program);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  const u={};for(const k of ['resolution','time','pointer','scroll','hover'])u[k]=gl.getUniformLocation(program,k);
  const hero=canvas.closest('.hero');
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  let px=0,py=0,x=0,y=0,hoverTarget=0,hover=0,scroll=0,clock=0,last=0,visible=true,wasPaused=false,needsDraw=true;
  const size=()=>{const r=canvas.getBoundingClientRect();const dpr=Math.min(window.devicePixelRatio||1,1.5);canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);gl.viewport(0,0,canvas.width,canvas.height);needsDraw=true;};
  new ResizeObserver(size).observe(canvas);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;},{rootMargin:'100px'}).observe(canvas);
  const resetPointer=()=>{px=0;py=0;hoverTarget=0;};
  // Measure from the atom, not the window; only react in and around its visible area.
  hero.addEventListener('pointermove',e=>{
    if(e.pointerType==='touch'||isPaused())return;
    const r=canvas.parentElement.getBoundingClientRect();
    const nx=(e.clientX-r.left-r.width/2)/(r.width*.42);
    const ny=(e.clientY-r.top-r.height/2)/(r.height*.42);
    hoverTarget=clamp((1.3-Math.hypot(nx,ny))/.35,0,1);
    px=clamp(nx,-1,1)*hoverTarget;
    py=clamp(ny,-1,1)*hoverTarget;
  },{passive:true});
  hero.addEventListener('pointerleave',resetPointer);
  window.addEventListener('blur',resetPointer);
  window.addEventListener('scroll',resetPointer,{passive:true});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();canvas.parentElement.classList.add('no-webgl');});
  size();
  const frame=now=>{
    requestAnimationFrame(frame);
    const delta=Math.min((now-last)/1000,.06);last=now;
    if(!visible||document.hidden)return;
    const paused=isPaused();
    if(paused&&wasPaused&&!needsDraw)return;
    wasPaused=paused;needsDraw=false;
    if(!paused){
      // Time-based damping feels the same on 60 Hz and 144 Hz displays.
      const ease=1-Math.exp(-delta*8);
      x+=(px-x)*ease;y+=(py-y)*ease;hover+=(hoverTarget-hover)*ease;
      scroll+=(Math.min(window.scrollY/window.innerHeight,1)-scroll)*(1-Math.exp(-delta*5));
      clock+=delta*(1-hover*.65);
    }
    gl.uniform2f(u.resolution,canvas.width,canvas.height);gl.uniform1f(u.time,clock+3.7);gl.uniform2f(u.pointer,paused?0:x,paused?0:y);gl.uniform1f(u.hover,paused?0:hover);gl.uniform1f(u.scroll,paused?0:scroll);
    canvas.style.transform=`translate3d(${paused?0:x*10}px,${paused?0:y*8}px,0)`;
    gl.drawArrays(gl.TRIANGLES,0,6);
  };
  requestAnimationFrame(frame);
}
