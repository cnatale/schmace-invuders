import {
  waitForEvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';

// Wait for hte bridge to be ready before doing anything else.
// In the simulator this resolves immediately; on hardware it waits
// for the WebView to initialize the SDK bridge.
const bridge = await waitForEvenAppBridge();

// Build a single text container that fills the visible canvas (576x288).
const mainText = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'main',
  content: 'Hello world!\n\nTap to count: 0\nDouble-tap to exit',
  isEventCapture: 1,  // <- receive click events on this container
});

// Render the page. `result` is 0 on success.
const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [mainText]
  })
);

if (result !== 0) {
  console.error('createStartUpPageContainer failed:', result);
  // 1 = invalid params, 2 = oversize, 3 = out of memory
}

// Single event subscription - all OS events arrive through onEvenHubEvent
// Inspect event.textEvent / event.listEvent / event.sysEvent to route by source.
let count = 0;

bridge.onEvenHubEvent((event) => {
  // Tap and double-tap arrive on sysEvent; scroll arrives on textEvent for the
  // capturing container. Both sources have to be handled to see a tap at all.
  const source = event.textEvent ?? event.sysEvent;
  if (!source) return;

  // sysEvent carries no containerID, so only filter when the event is scoped to one.
  if (event.textEvent && event.textEvent.containerID !== 1) return;

  // Event_Type is omitted on the wire for CLICK_EVENT since its PB ordinal is 0.
  const eventType = source.eventType ?? OsEventTypeList.CLICK_EVENT;

  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT:
      count++;
      console.log('count:', count);
      bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 1,
        containerName: 'main',
        content: `Hello world!\n\nTap to count: ${count}\nDouble-tap to exit`,
      }))
      break;

    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      // Mode 1 shows the system exit-confirmation dialog -
      // required on the root page; silent exit (mode 0) is rejected in QA.
      bridge.shutDownPageContainer(1)
      break;
  }
})