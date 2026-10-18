export function navelPolicy({fitStyle,dome,covered,outward}){
 if(fitStyle!=='spandex')return {apply:false,reason:'relaxed fit retains its original drape; navel corrective disabled'};
 if(!outward)return {apply:false,reason:'bare baseline is innie; approved shape retained'};
 if(!covered)return {apply:false,reason:'navel outside existing shirt cut'};
 if(!dome)return {apply:false,reason:'dome option off'};
 return {apply:true};
}
