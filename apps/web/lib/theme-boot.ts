/** Ilk boyamadan once temayi uygular (yanip sonmeyi onler). Sunucu bileseninden <head>'e gomulur. */
export const THEME_KEY = "app.theme";
export const THEME_BOOT_SCRIPT =
  `(function(){try{var m=localStorage.getItem("${THEME_KEY}")||"system";` +
  `var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);` +
  `var r=document.documentElement;if(d){r.classList.add("dark");}r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
