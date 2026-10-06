import type {LabView} from './lab-camera';
// Shot ranges refer to the pinned canonical Chapter One sourceIndex, not queue
// offsets. They stage the existing manuscript; they do not add story events.
export const chapterOneShots:readonly {start:number;title:string;view:LabView}[]=[
 {start:2,title:'Late shift',view:'room'},
 {start:4,title:'Security warning',view:'room'},
 {start:6,title:'Jack wakes',view:'firstperson'},
 {start:8,title:'Security warning',view:'terminal'},
 {start:26,title:'Calling Sarah',view:'webcam'},
 {start:48,title:'The directory',view:'terminal'},
 {start:54,title:'Sarah arrives',view:'room'},
 {start:59,title:'At Jack’s shoulder',view:'conversation'},
 {start:65,title:'The test results',view:'terminal'},
 {start:77,title:'Reviewing together',view:'conversation'},
 {start:103,title:'The second chair',view:'conversation'},
 {start:127,title:'A quiet moment',view:'conversation'},
 {start:150,title:'Remote initialization',view:'terminal'},
 {start:170,title:'I didn’t',view:'conversation'},
];
export function chapterOneShot(sourceIndex:number){return [...chapterOneShots].reverse().find(shot=>sourceIndex>=shot.start)??chapterOneShots[0];}
