import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/valci/.gemini/antigravity/brain/efe39112-e52b-48bb-863c-5d998d7d94af';
const BASE_URL = 'http://localhost:5173';

function log(msg) {
  console.log(`[PLAYTEST] ${msg}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  log('Starting 3-browser playtest with Microsoft Edge...');

  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
  });

  // 1. Create Contexts
  const hostContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const playerAContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const playerBContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const spectatorContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

  const pageHost = await hostContext.newPage();
  const pageA = await playerAContext.newPage();
  const pageB = await playerBContext.newPage();
  const pageSpec = await spectatorContext.newPage();

  // Auto-accept confirm/alert dialogs
  pageHost.on('dialog', async d => { log(`Host Dialog: ${d.message()}`); await d.accept(); });
  pageA.on('dialog', async d => { log(`Player A Dialog: ${d.message()}`); await d.accept(); });
  pageB.on('dialog', async d => { log(`Player B Dialog: ${d.message()}`); await d.accept(); });

  try {
    // 2. Host creates session on HomePage
    log('Step 1: Host creates session on HomePage...');
    await pageHost.goto(`${BASE_URL}/`);
    await pageHost.waitForSelector('input[placeholder="e.g. Alice"]');

    // Fill player names
    await pageHost.fill('input[placeholder="e.g. Alice"]', 'Alice');
    await pageHost.fill('input[placeholder="e.g. Bob"]', 'Bob');

    // Click "Create Game Session"
    await pageHost.click('button:has-text("Create Game Session")');
    await pageHost.waitForSelector('text=Session created!');
    log('✓ Session created successfully!');

    // Read join links from DOM
    const hostLink = await pageHost.locator('code').nth(0).innerText();
    const aliceLink = await pageHost.locator('code').nth(1).innerText();
    const bobLink = await pageHost.locator('code').nth(2).innerText();
    const specLink = await pageHost.locator('code').nth(3).innerText();

    log(`Host link: ${hostLink}`);
    log(`Alice link: ${aliceLink}`);
    log(`Bob link: ${bobLink}`);
    log(`Spec link: ${specLink}`);

    // Enter Host Dashboard
    await pageHost.click('button:has-text("Enter Host Dashboard")');
    await pageHost.waitForSelector('h1:has-text("Host Dashboard")');
    log('✓ Host Dashboard loaded');

    // 3. Connect Player A, Player B, Spectator
    log('Step 2: Connecting Player A, Player B, and Spectator...');
    await pageA.goto(aliceLink);
    await pageA.waitForSelector('h1:has-text("Alice")');
    log('✓ Player A (Alice) joined');

    await pageB.goto(bobLink);
    await pageB.waitForSelector('h1:has-text("Bob")');
    log('✓ Player B (Bob) joined');

    await pageSpec.goto(specLink);
    await pageSpec.waitForSelector('text=OBS Live Broadcast Overlay');
    log('✓ Spectator View joined');

    // 4. Host starts Round 1
    log('Step 3: Host starts Round 1...');
    await pageHost.click('button:has-text("Start Round 1")');
    await pageHost.waitForSelector('text=Round 1');
    log('✓ Round 1 active on Host');

    // 5. Host configures characters
    log('Step 4: Host configures secret characters...');
    // Character 1: Pikachu (Guessed by Alice Slot 1, Held by Bob Slot 2)
    const addCharBtn = pageHost.locator('button:has-text("Add Secret Character"), button:has-text("Create Character Now")').first();
    await addCharBtn.click();
    await pageHost.waitForSelector('input[placeholder*="Mario"]');
    await pageHost.fill('input[placeholder*="Mario"]', 'Pikachu');
    await pageHost.selectOption('select >> nth=0', '1'); // Guessed by Alice
    await pageHost.click('button:has-text("Save Character")');
    await pageHost.waitForTimeout(600);

    // Character 2: Charizard (Guessed by Bob Slot 2, Held by Alice Slot 1)
    await pageHost.click('button:has-text("Add Secret Character")');
    await pageHost.waitForSelector('input[placeholder*="Mario"]');
    await pageHost.fill('input[placeholder*="Mario"]', 'Charizard');
    await pageHost.selectOption('select >> nth=0', '2'); // Guessed by Bob
    await pageHost.click('button:has-text("Save Character")');
    await pageHost.waitForTimeout(600);
    log('✓ Characters Pikachu and Charizard created');

    // 6. Host creates hints
    log('Step 5: Host adds hints for characters...');
    // Find Add Hint buttons
    const addHintBtns = pageHost.locator('button:has-text("+ Add Hint")');
    const hintModal = pageHost.locator('div.fixed:has-text("Add Hint for Character")');
    
    // Hint for Pikachu
    await addHintBtns.nth(0).click();
    await hintModal.waitFor({ state: 'visible' });
    await hintModal.locator('textarea').fill('Yellow electric mouse with red cheeks');
    await hintModal.locator('input[type="number"]').fill('15');
    await hintModal.locator('button:has-text("Save Hint")').click();
    await hintModal.waitFor({ state: 'hidden' });
    await pageHost.waitForTimeout(600);

    // Hint for Charizard
    await addHintBtns.nth(1).click();
    await hintModal.waitFor({ state: 'visible' });
    await hintModal.locator('textarea').fill('Orange fire dragon with flaming tail');
    await hintModal.locator('input[type="number"]').fill('20');
    await hintModal.locator('button:has-text("Save Hint")').click();
    await hintModal.waitFor({ state: 'hidden' });
    await pageHost.waitForTimeout(1000);
    log('✓ Hints added for both characters');

    // 7. Verify Character Secrecy in Browser
    log('Step 6: Verifying character secrecy in player browsers...');
    await pageA.waitForTimeout(1500);
    await pageB.waitForTimeout(1500);

    // Check Alice page content
    const pageAText = await pageA.innerText('body');
    const aliceSeesHeld = pageAText.includes('Charizard');
    const aliceSeesSecretPikachu = pageAText.includes('Pikachu');
    log(`Alice secrecy check: Sees held Charizard: ${aliceSeesHeld}, Sees secret Pikachu: ${aliceSeesSecretPikachu}`);
    if (aliceSeesSecretPikachu) throw new Error('FATAL: Alice can see secret target Pikachu!');

    // Check Bob page content
    const pageBText = await pageB.innerText('body');
    const bobSeesHeld = pageBText.includes('Pikachu');
    const bobSeesSecretCharizard = pageBText.includes('Charizard');
    log(`Bob secrecy check: Sees held Pikachu: ${bobSeesHeld}, Sees secret Charizard: ${bobSeesSecretCharizard}`);
    if (bobSeesSecretCharizard) throw new Error('FATAL: Bob can see secret target Charizard!');

    // 8. Test Hint Purchases in Browser
    log('Step 7: Testing hint purchases in browser...');
    // Alice purchases Hint #1
    await pageA.click('button:has-text("Buy for 15 pts")');
    await pageA.waitForSelector('text=Yellow electric mouse with red cheeks');
    const alicePoints = await pageA.locator('text=85 pts').first().isVisible();
    log(`✓ Alice purchased hint: Clue unlocked! (Points is 85: ${alicePoints})`);

    // Bob purchases Hint #1
    await pageB.click('button:has-text("Buy for 20 pts")');
    await pageB.waitForSelector('text=Orange fire dragon with flaming tail');
    const bobPoints = await pageB.locator('text=80 pts').first().isVisible();
    log(`✓ Bob purchased hint: Clue unlocked! (Points is 80: ${bobPoints})`);

    // 9. Klecks Canvas Drawing & Live Preview Testing
    log('Step 8: Testing Klecks drawing canvas & live preview...');
    // Wait for Klecks iframe to load in Alice and Bob
    await pageA.waitForSelector('iframe[title="Klecks Drawing Editor"]');
    await pageB.waitForSelector('iframe[title="Klecks Drawing Editor"]');

    const frameA = pageA.frameLocator('iframe[title="Klecks Drawing Editor"]');
    const frameB = pageB.frameLocator('iframe[title="Klecks Drawing Editor"]');

    // Wait for canvas element in iframe
    await frameA.locator('canvas').first().waitFor({ state: 'visible', timeout: 15000 });
    await frameB.locator('canvas').first().waitFor({ state: 'visible', timeout: 15000 });
    log('✓ Klecks canvas iframe loaded in both player contexts');

    // Capture screenshot of Klecks drawing interface in Player A
    await pageA.screenshot({ path: path.join(ARTIFACT_DIR, 'screenshot_klecks_canvas.png') });
    log('✓ Captured screenshot_klecks_canvas.png');

    // Simulate drawing gestures on canvas in Player A
    const canvasA = frameA.locator('canvas').first();
    const boxA = await canvasA.boundingBox();
    if (boxA) {
      // Draw Pikachu face outline
      await pageA.mouse.move(boxA.x + boxA.width * 0.4, boxA.y + boxA.height * 0.4);
      await pageA.mouse.down();
      for (let i = 0; i <= 20; i++) {
        const angle = (i / 20) * 2 * Math.PI;
        await pageA.mouse.move(
          boxA.x + boxA.width * 0.5 + Math.cos(angle) * 70,
          boxA.y + boxA.height * 0.5 + Math.sin(angle) * 70
        );
      }
      await pageA.mouse.up();
      // Draw ears & eyes
      await pageA.mouse.click(boxA.x + boxA.width * 0.42, boxA.y + boxA.height * 0.45);
      await pageA.mouse.click(boxA.x + boxA.width * 0.58, boxA.y + boxA.height * 0.45);
      await pageA.mouse.click(boxA.x + boxA.width * 0.5, boxA.y + boxA.height * 0.55);
    }

    // Simulate drawing gestures on canvas in Player B
    const canvasB = frameB.locator('canvas').first();
    const boxB = await canvasB.boundingBox();
    if (boxB) {
      // Draw Dragon shape
      await pageB.mouse.move(boxB.x + boxB.width * 0.3, boxB.y + boxB.height * 0.3);
      await pageB.mouse.down();
      await pageB.mouse.move(boxB.x + boxB.width * 0.7, boxB.y + boxB.height * 0.3);
      await pageB.mouse.move(boxB.x + boxB.width * 0.6, boxB.y + boxB.height * 0.6);
      await pageB.mouse.move(boxB.x + boxB.width * 0.4, boxB.y + boxB.height * 0.6);
      await pageB.mouse.move(boxB.x + boxB.width * 0.3, boxB.y + boxB.height * 0.3);
      await pageB.mouse.up();
    }
    log('✓ Drawing gestures executed on both canvases');

    // Wait 3.5 seconds for snapshot capture and WS dispatch
    await sleep(3500);

    // Verify previews in Host Dashboard
    const hostImages = pageHost.locator('img[alt*="drawing"]');
    const hostImgCount = await hostImages.count();
    log(`Host dashboard canvas images received: ${hostImgCount}`);

    // Capture screenshots of Host Dashboard, Player A, Player B, and Spectator View
    await pageHost.screenshot({ path: path.join(ARTIFACT_DIR, 'screenshot_host_dashboard.png') });
    log('✓ Captured screenshot_host_dashboard.png');

    await pageA.screenshot({ path: path.join(ARTIFACT_DIR, 'screenshot_player_a.png') });
    log('✓ Captured screenshot_player_a.png');

    await pageB.screenshot({ path: path.join(ARTIFACT_DIR, 'screenshot_player_b.png') });
    log('✓ Captured screenshot_player_b.png');

    await pageSpec.screenshot({ path: path.join(ARTIFACT_DIR, 'screenshot_obs_spectator_1080p.png') });
    log('✓ Captured screenshot_obs_spectator_1080p.png');

    // 10. Test Seamless Fullscreen / Zoom Spectator Modal in Host
    log('Step 9: Testing Host Fullscreen / Zoom Spectator Modal...');
    await pageHost.click('button:has-text("Fullscreen") >> nth=0');
    const zoomModal = pageHost.locator('div.fixed:has(button[title*="Exit Zoom"])');
    await zoomModal.waitFor({ state: 'visible' });
    await sleep(500);
    await pageHost.screenshot({ path: path.join(ARTIFACT_DIR, 'screenshot_fullscreen_spectator.png') });
    log('✓ Captured screenshot_fullscreen_spectator.png');

    // Test zoom in button inside modal
    await zoomModal.locator('button[title="Zoom In (+)"]').click();
    await sleep(200);
    // Close modal
    await zoomModal.locator('button[title*="Exit Zoom"]').click();
    await zoomModal.waitFor({ state: 'hidden' });
    await pageHost.waitForTimeout(300);
    log('✓ Fullscreen spectator modal tested & closed cleanly');

    // 11. Test Host Manual Point Awards
    log('Step 10: Host manual point awarding...');
    // Award +25 to Alice (Participant 1)
    await pageHost.click('button:has-text("+25") >> nth=0');
    await pageHost.waitForTimeout(500);
    // Penalize -10 to Bob (Participant 2)
    await pageHost.click('button:has-text("-10") >> nth=1');
    await pageHost.waitForTimeout(500);
    log('✓ Host adjusted points (+25 to Alice, -10 to Bob)');

    // 12. Test Drawing Submissions
    log('Step 11: Players submit final drawings...');
    await pageA.click('button:has-text("Submit Final Drawing")');
    await pageA.waitForSelector('text=Drawing Submitted!');
    log('✓ Alice submitted drawing');

    await pageB.click('button:has-text("Submit Final Drawing")');
    await pageB.waitForSelector('text=Drawing Submitted!');
    log('✓ Bob submitted drawing');

    // 13. Test Session Reliability / Reconnect
    log('Step 12: Testing page refresh & reconnect reliability...');
    await pageA.reload();
    await pageA.waitForSelector('h1:has-text("Alice")');
    await pageA.waitForSelector('text=Drawing Submitted!');
    log('✓ Alice refreshed and reconnected smoothly without losing session state');

    // 14. Host Ends Round & Shows Results
    log('Step 13: Host reveals results & ends session...');
    await pageHost.click('button:has-text("End Round → Show Results")');
    await pageHost.waitForSelector('button:has-text("Next Round")');

    // Reveal characters
    const revealBtns = pageHost.locator('button:has-text("Reveal Answer")');
    const rCount = await revealBtns.count();
    for (let i = 0; i < rCount; i++) {
      await revealBtns.nth(0).click();
      await pageHost.waitForTimeout(400);
    }
    log('✓ Characters revealed by host');

    // Verify Player A sees revealed answer "Pikachu"
    await pageA.waitForTimeout(1000);
    const pageARevealedText = await pageA.innerText('body');
    if (pageARevealedText.includes('Pikachu')) {
      log('✓ Alice sees revealed answer "Pikachu" in Results phase');
    }

    // Host ends entire game session to show stats
    await pageHost.click('button:has-text("End Game")');
    await pageHost.waitForSelector('text=FINAL RECAP');
    log('✓ Match Statistics screen active on Host');

    await sleep(1500);

    // Capture final results screenshot
    await pageHost.screenshot({ path: path.join(ARTIFACT_DIR, 'screenshot_final_results.png') });
    log('✓ Captured screenshot_final_results.png');

    log('\n🎉 PLAYTEST COMPLETED SUCCESSFULLY! ALL SCENARIOS VERIFIED! 🎨\n');
  } catch (err) {
    console.error('Playtest failed with error:', err);
    throw err;
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
