import type { SceneLook } from './assets';
export interface Interaction { id: string; label: string; detail: string; dialogue: string; required?: boolean; requires?: string; effect?: 'shutdown' | 'disconnect'; }
export interface StoryScene { id: string; chapter: number; title: string; location: string; look: SceneLook; dialogue: string; objective: string; panel: string; intensity: number; actions: Interaction[]; exit: string; }
export const story: StoryScene[] = [
 {id:'alarm',chapter:1,title:'The Alarm',location:'Diagnostic laboratory',look:'console',dialogue:'wake',objective:'Find the source of the security warning.',panel:'security',intensity:1,actions:[
  {id:'trace',label:'Trace the connection',detail:'Network monitor',dialogue:'trace',required:true},
  {id:'lock',label:'Lock the terminal',detail:'TOMBS directory',dialogue:'lock',required:true,requires:'trace'},
 ],exit:'Call Sarah'},
 {id:'intercom',chapter:1,title:'A familiar voice',location:'Diagnostic laboratory',look:'console',dialogue:'call',objective:'Wait for Sarah at the terminal.',panel:'intercom',intensity:1,actions:[],exit:'Turn toward the door'},
 {id:'sarah',chapter:1,title:'Too clean',location:'Diagnostic laboratory',look:'laboratory',dialogue:'arrive',objective:'Review the logs with Sarah.',panel:'logs',intensity:1,actions:[
  {id:'logs',label:'Inspect access logs',detail:'Security history',dialogue:'logs',required:true},
  {id:'baby',label:'Talk to Sarah',detail:'A quiet moment',dialogue:'baby'},
 ],exit:'Check the new warning'},
 {id:'revoked',chapter:1,title:'Access revoked',location:'Diagnostic laboratory',look:'console',dialogue:'request',objective:'Cancel the remote initialization.',panel:'request',intensity:2,actions:[
  {id:'reject',label:'Reject initialization',detail:'Remote request pending',dialogue:'reject',required:true},
  {id:'credentials',label:'Use administrator access',detail:'Dr. Jack Bennett',dialogue:'credentials',required:true,requires:'reject'},
 ],exit:'Follow the sound of the array'},
 {id:'corridor',chapter:2,title:'The Boundary',location:'Laboratory corridor',look:'corridor',dialogue:'corridor',objective:'Reach the main control room together.',panel:'none',intensity:2,actions:[],exit:'Contact utility control'},
 {id:'power',chapter:2,title:'Fourteen. Fifteen.',location:'Laboratory corridor',look:'corridor',dialogue:'power',objective:'Disconnect TOMBS from the island grid.',panel:'power',intensity:3,actions:[
  {id:'disconnect',label:'Request grid isolation',detail:'Lena Ortiz · Utility control',dialogue:'disconnect',required:true,effect:'disconnect'},
  {id:'reactor',label:'Check backup power',detail:'Capacitors and reactor',dialogue:'reactor',requires:'disconnect'},
 ],exit:'Enter the main control room'},
 {id:'array',chapter:2,title:'The physical connection',location:'TOMBS control room',look:'array',dialogue:'array',objective:'Use the physical emergency shutdown.',panel:'array',intensity:3,actions:[
  {id:'shutdown',label:'Pull shutdown lever',detail:'Physical emergency disconnect',dialogue:'shutdown',required:true,effect:'shutdown'},
 ],exit:'Inspect the target parameters'},
 {id:'boundary',chapter:2,title:'Not a town',location:'TOMBS control room',look:'array',dialogue:'boundary',objective:'Identify the boundary. Contact the settlement.',panel:'boundary',intensity:4,actions:[
  {id:'map',label:'Open the boundary map',detail:'Target coordinates',dialogue:'map',required:true},
  {id:'shelter',label:'Call settlement control',detail:'Emergency protocol',dialogue:'shelter',required:true,requires:'map'},
  {id:'overload',label:'Review emitter overload',detail:'Discuss the risk with Sarah',dialogue:'overload'},
 ],exit:'Try another control route'},
 {id:'acquired',chapter:2,title:'Boundary acquired',location:'TOMBS control room',look:'array',dialogue:'acquired',objective:'Interrupt the calculation.',panel:'locked',intensity:4,actions:[
  {id:'manual',label:'Request manual control',detail:'Emergency override',dialogue:'manual',required:true},
 ],exit:'Steady Sarah'},
 {id:'locked',chapter:3,title:'The Activation',location:'TOMBS control room',look:'array',dialogue:'steady',objective:'Stay with Sarah.',panel:'locked',intensity:5,actions:[],exit:"Hold Sarah’s hand"},
 {id:'activation',chapter:3,title:'Scale factor locked',location:'TOMBS control room',look:'array',dialogue:'activate',objective:'',panel:'none',intensity:5,actions:[],exit:'Stay with Sarah'},
 {id:'recovery',chapter:3,title:'He moved',location:'TOMBS control room',look:'aftermath',dialogue:'recovery',objective:'Help Sarah to her feet.',panel:'none',intensity:0,actions:[],exit:'Look around the laboratory'},
 {id:'normal',chapter:3,title:'An unsettling silence',location:'TOMBS control room',look:'aftermath',dialogue:'normal',objective:'Check the laboratory systems.',panel:'sensors',intensity:0,actions:[
  {id:'sensors',label:'Inspect local sensors',detail:'Environment and structural integrity',dialogue:'sensors',required:true},
 ],exit:"Answer Lena’s call"},
 {id:'comms',chapter:3,title:'Nothing beyond the settlement',location:'TOMBS control room',look:'aftermath',dialogue:'lena',objective:'Listen to Sarah.',panel:'comms',intensity:0,actions:[],exit:'Lower your wrist terminal'},
 {id:'window',chapter:3,title:'Come here',location:'Control room window',look:'aftermath',dialogue:'window',objective:'Join Sarah at the window.',panel:'none',intensity:0,actions:[],exit:'Look outside'},
 {id:'outside',chapter:3,title:'Beyond the streetlights',location:'Control room window',look:'window',dialogue:'outside',objective:'Open the external camera feeds.',panel:'none',intensity:0,actions:[],exit:'Open perimeter cameras'},
 {id:'cameras',chapter:3,title:'The same island',location:'Perimeter surveillance',look:'cameras',dialogue:'camera',objective:'Inspect the perimeter feeds.',panel:'cameras',intensity:0,actions:[
  {id:'north',label:'01 · Northern perimeter',detail:'Grass beyond the developed zone',dialogue:'north',required:true},
  {id:'west',label:'02 · Western road',detail:'Earth and vegetation',dialogue:'west',required:true},
  {id:'tree',label:'03 · Familiar tree',detail:'Trunk exceeds the frame',dialogue:'tree',required:true},
  {id:'zoom',label:'04 · Communications building',detail:'Turn toward the coastline',dialogue:'zoom',required:true},
  {id:'water',label:'05 · Southern boundary',detail:'Security light',dialogue:'water',required:true},
 ],exit:'Check the vibration'},
 {id:'tremor',chapter:3,title:'Distant thunder',location:'TOMBS control room',look:'aftermath',dialogue:'tremor',objective:'Read the final TOMBS record.',panel:'sensors',intensity:0,actions:[],exit:'Open the event log'},
 {id:'event',chapter:3,title:'Boundary event complete',location:'TOMBS event log',look:'window',dialogue:'event',objective:'Overlay the event boundary on the settlement.',panel:'event',intensity:0,actions:[
  {id:'everyone',label:'Show the affected boundary',detail:'Research district · Homes · Medical center',dialogue:'everyone',required:true},
 ],exit:"Take Sarah’s hand"},
 {id:'ending',chapter:3,title:'And the island had not',location:'End of Chapter 3',look:'ending',dialogue:'end',objective:'',panel:'none',intensity:0,actions:[],exit:'Return to title'},
];
