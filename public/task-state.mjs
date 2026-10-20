export function taskParameters(defaults,source={}){
  return {...defaults,...source,prompt:'',repeat:1};
}
