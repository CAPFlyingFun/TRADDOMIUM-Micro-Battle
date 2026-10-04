import type { Speaker } from './characters';
import chapterOne from './lab-dialogue.json';
export interface Line { speaker: Speaker; text: string; voiceKey?:string; sourceIndex?:number }
const l = (speaker: Speaker, text: string): Line => ({ speaker, text });
// Spoken lines below are taken from the supplied Chapters 1–3.
export const dialogue: Record<string, Line[]> = {
 wake: [l('narrator','March fifth, 2110. Almost eleven at night.'),l('system','Warning. unauthorized system access.'),l('jack',"What? Okay, I'm awake."),l('jack',"That's not good.")],
 trace: [l('jack','Come on. What are you doing?'),l('jack',"No. Where'd you go?"),l('system','Security protocol violation.'),l('jack','Okay. Definitely awake now.')],
 lock: [l('jack',"Oh, no you don't."),l('narrator','The screen goes black. Three seconds later, the same directory reopens.'),l('jack',"Well, that's new.")],
 call: [l('jack','Sarah, you there?'),l('sarah',"I'm here."),l('sarah',"What's wrong?"),l('jack',"I've got something weird on my computer. It tripped a security alarm."),l('sarah','Define weird.'),l('jack',"I think somebody's in the system."),l('sarah','Are you sure?'),l('jack',"No. That's why I'm calling the smarter scientist."),l('sarah','Good answer.'),l('jack','Can you come take a look?'),l('sarah',"I'm on my way.")],
 arrive: [l('sarah',"Please tell me you didn't break something."),l('jack','I was asleep.'),l('sarah','You called me in here to admit that?'),l('jack','No. That was my defense.'),l('sarah','Against what?'),l('jack','Whatever this is.')],
 logs: [l('sarah','These are clean.'),l('jack','Exactly.'),l('sarah','Too clean.'),l('jack',"That's what I was thinking."),l('sarah','No, you were sleeping.'),l('jack','I was thinking eventually.')],
 baby: [l('jack',"You know, you're supposed to be resting."),l('sarah','So are you.'),l('jack',"I'm not the pregnant one."),l('sarah',"No. You're the one I found asleep at a laboratory terminal."),l('sarah','Lately the baby seems to think eleven at night is morning.'),l('jack','Already takes after me.'),l('sarah',"That's what I'm afraid of.")],
 request: [l('system','Tombs array remote initialization request.'),l('sarah','Did you do that?'),l('jack','No.'),l('sarah','Cancel it.')],
 reject: [l('system','Request denied.'),l('system','Request denied.'),l('jack',"That's not supposed to happen.")],
 credentials: [l('system','Access revoked.'),l('sarah','Your credentials?'),l('jack','Revoked.'),l('sarah',"You're the project administrator."),l('jack','I know.'),l('sarah','Who can revoke you?'),l('jack','Me.'),l('sarah','Jack.'),l('jack',"I didn't.")],
 corridor: [l('sarah','Was that the array?'),l('jack','Stay here.'),l('sarah','Absolutely not.'),l('sarah','Being thirty-two weeks pregnant does not mean made of glass.'),l('jack',"It means you're carrying something considerably more important than this laboratory."),l('sarah',"And you're his father."),l('sarah',"So we're both going."),l('jack','Fine. But stay with me.'),l('sarah','That I can do.')],
 power: [l('system','Warning. array power above standby threshold.'),l('jack','Control, this is Bennett. Shut down power to TOMBS.'),l('lena',"Jack, we were about to call you. We're seeing a massive draw from your building."),l('jack','How massive?'),l('lena','Fourteen megawatts and climbing.'),l('jack','Fourteen?'),l('lena','Fifteen now.'),l('sarah',"Yesterday's full test didn't use half that.")],
 disconnect: [l('jack','Possible network intrusion. Cut external access to the laboratory and disconnect TOMBS from the island grid.'),l('lena','Doing it now.'),l('lena','Jack? We disconnected you.'),l('jack',"It's still running."),l('lena',"That's impossible."),l('jack',"Tonight's developing a theme.")],
 reactor: [l('sarah','Backup capacitors?'),l('jack','Not enough for this.'),l('sarah','Internal reactor?'),l('jack','Offline.'),l('sarah','Then where is it getting the power?'),l('jack',"I don't know.")],
 array: [l('narrator','Beyond the reinforced window, every ring is moving.'),l('sarah',"You didn't authorize an experiment?"),l('jack','No.'),l('sarah','Boundary emitters are active.'),l('jack','Kill them.'),l('sarah',"They're not responding.")],
 shutdown: [l('jack',"Then we'll do it the old-fashioned way."),l('sarah','Okay.'),l('jack','That worked.'),l('sarah','Jack.'),l('jack','I cut the physical connection.'),l('sarah','Apparently TOMBS disagrees.'),l('jack',"Machines don't get opinions."),l('sarah','This one seems pretty committed.')],
 boundary: [l('system','Boundary acquisition in progress.'),l('sarah','What boundary?'),l('jack',"That's wrong."),l('sarah','What?'),l('jack','The target dimensions.'),l('sarah',"That can't be right. That's kilometers.")],
 map: [l('sarah',"That's us."),l('jack',"No. The array can't do this."),l('sarah','The boundary says otherwise.'),l('jack','Not a town.'),l('sarah','Target mass is still calculating.')],
 shelter: [l('jack','Control, initiate a settlement-wide emergency.'),l('lena','What level?'),l('jack','Full evacuation protocol.'),l('sarah','Evacuate where?'),l('lena','Jack?'),l('jack',"Change that order. Tell everyone to get indoors and away from exterior walls. Nobody leaves the developed zone until we understand what this thing is doing."),l('lena','Understood.')],
 overload: [l('sarah','Could we overload the emitters?'),l('jack','Maybe.'),l('sarah','Maybe good, or maybe everyone-inside-the-field-dies bad?'),l('jack','The second one.'),l('sarah',"Then let's not.")],
 acquired: [l('system','Boundary acquired.'),l('jack','No.'),l('system','Scale factor calculating.'),l('sarah',"Someone isn't just activating TOMBS."),l('jack','No.'),l('sarah',"They're running it.")],
 manual: [l('jack','Give me manual control.'),l('system','Access denied.'),l('jack','Come on. Give me manual control!'),l('system','Access denied.'),l('sarah',"I'll try to interrupt the calculation."),l('jack','Do it.'),l('sarah','Nothing.'),l('jack','Again.'),l('sarah','I am.')],
 steady: [l('jack','You okay?'),l('sarah',"I'm fine."),l('jack','Sarah.'),l('sarah',"I'm fine. Keep working."),l('system','Scale factor locked.'),l('sarah','What does that mean?'),l('jack',"That's not possible."),l('sarah','What does it mean?')],
 activate: [],
 recovery: [l('jack','Sarah!'),l('jack','Are you hurt?'),l('sarah',"I'm here. I don't think so."),l('jack','The baby?'),l('sarah','Give me a second.'),l('jack','Sarah?'),l('sarah','He moved.'),l('jack','Okay.'),l('sarah',"We're okay.")],
 normal: [l('narrator','The alarms stop. The laboratory looks exactly as it did before.'),l('sarah','Did it fail?')],
 sensors: [l('jack','TOMBS is offline.'),l('sarah','Offline because you stopped it?'),l('jack','No.'),l('jack','Offline because it finished.'),l('sarah','Finished what?'),l('jack',"Everything says we're fine."),l('jack','Which means something is very wrong.')],
 lena: [l('lena',"Jack! Jack, answer me!"),l('jack',"I'm here."),l('lena','Something happened.'),l('jack','I know. Status?'),l('lena',"We've got power. Most systems are responding, but communications are down."),l('jack','Internal?'),l('lena',"External. We can't reach anything beyond the settlement."),l('jack','Satellite?'),l('lena','Nothing.'),l('jack','Radio?'),l('lena','Nothing.')],
 window: [l('sarah','Jack.'),l('jack','Try the emergency frequencies.'),l('sarah','Jack.'),l('jack','One second.'),l('sarah','Jack, come here.')],
 outside: [l('narrator','The street is there. The building across from them is there. Everything inside the settlement looks normal.'),l('sarah','Is that... grass?'),l('jack','No.'),l('sarah','Jack, what did TOMBS do?'),l('jack','External cameras.')],
 camera: [l('narrator','The perimeter feeds come online.')],
 north: [l('narrator','The northern edge is buried beneath towering grass.')],
 west: [l('narrator','The western road ends at an enormous wall of earth and vegetation.')],
 tree: [l('narrator',"A tree Jack has walked past hundreds of times. Now the camera cannot fit its trunk on the screen.")],
 zoom: [l('sarah','Can you zoom out?'),l('jack','It is zoomed out.')],
 water: [l('sarah',"That's a drop of water.")],
 tremor: [l('narrator','A faint, deep vibration passes through the building.'),l('sarah','Was that us?'),l('jack','No seismic event.'),l('sarah','Then what was it?')],
 event: [l('sarah','The town...'),l('system','Boundary event complete.'),l('sarah','No.')],
 everyone: [l('sarah','It took all of us.'),l('jack','Everyone inside the boundary.'),l('sarah','The homes?'),l('jack','Yes.'),l('sarah','The medical center?'),l('jack','Yes.'),l('sarah','Five hundred people.'),l('sarah','Jack...')],
 end: [l('narrator','Their town had shrunk.'),l('narrator','And the island had not.')],
};
// Chapter 1 is imported as complete recorded segments; Chapters 2–3 retain
// their existing adaptation until their own source refresh is requested.
Object.assign(dialogue, chapterOne);
