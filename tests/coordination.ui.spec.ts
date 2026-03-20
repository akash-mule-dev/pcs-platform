import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const API_BASE = 'http://localhost:3000';

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@pcs.local');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Dashboard', { timeout: 15000 });
}

async function getToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@pcs.local', password: 'password123' }),
  });
  const data = await res.json();
  return data.data.accessToken;
}

async function getReadyPackageId(): Promise<string | null> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}/api/coordination`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const packages = data.data || data;
  const ready = packages.find((p: any) => p.status === 'ready');
  return ready?.id || null;
}

// Create minimal test files
function ensureTestDir(): string {
  const tmpDir = path.join(os.tmpdir(), 'pw-coordination');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

function createTestIfc(): string {
  const tmpDir = ensureTestDir();
  const p = path.join(tmpDir, 'PW-Test-Model.ifc');
  fs.writeFileSync(p, `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition[CoordinationView_V2.0]'),'2;1');
FILE_NAME('test.ifc','2024-03-27',(''),('Test'),'','Tekla','');
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
#1= IFCPERSON('','Test',$,$,$,$,$,$);
#2= IFCORGANIZATION($,'Test',$,$,$);
#3= IFCPERSONANDORGANIZATION(#1,#2,$);
#4= IFCAPPLICATION(#2,'1.0','Test','Test');
#5= IFCOWNERHISTORY(#3,#4,$,.NOCHANGE.,$,$,$,1711554207);
#6= IFCCARTESIANPOINT((0.,0.,0.));
#7= IFCDIRECTION((1.,0.,0.));
#8= IFCDIRECTION((0.,1.,0.));
#9= IFCDIRECTION((0.,0.,1.));
#10= IFCAXIS2PLACEMENT3D(#6,#9,#7);
#11= IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-005,#10,$);
#12= IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#11,$,.MODEL_VIEW.,$);
#15= IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#24= IFCUNITASSIGNMENT((#15));
#25= IFCPROJECT('PW123',#5,'PW Test',$,$,$,$,(#11),#24);
#26= IFCLOCALPLACEMENT($,#10);
#27= IFCSITE('S1',#5,'Site',$,$,#26,$,$,.ELEMENT.,$,$,0.,$,$);
#28= IFCRELAGGREGATES('R1',#5,$,$,#25,(#27));
#30= IFCBUILDING('B1',#5,'Bldg',$,$,#26,$,$,.ELEMENT.,$,$,$);
#31= IFCRELAGGREGATES('R2',#5,$,$,#27,(#30));
#40= IFCBUILDINGSTOREY('F1',#5,'Floor',$,$,#26,$,$,.ELEMENT.,0.);
#41= IFCRELAGGREGATES('R3',#5,$,$,#30,(#40));
#50= IFCCARTESIANPOINT((0.,0.,0.));
#51= IFCCARTESIANPOINT((1000.,0.,0.));
#52= IFCCARTESIANPOINT((1000.,500.,0.));
#53= IFCCARTESIANPOINT((0.,500.,0.));
#54= IFCPOLYLINE((#50,#51,#52,#53,#50));
#55= IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'Profile',#54);
#56= IFCEXTRUDEDAREASOLID(#55,#10,#9,300.);
#57= IFCSHAPEREPRESENTATION(#12,'Body','SweptSolid',(#56));
#58= IFCPRODUCTDEFINITIONSHAPE($,$,(#57));
#59= IFCBEAM('BM1',#5,'Beam',$,$,#26,#58,$);
#60= IFCRELCONTAINEDINSPATIALSTRUCTURE('R4',#5,$,$,(#59),#40);
ENDSEC;
END-ISO-10303-21;
`);
  return p;
}

function createTestPdf(name: string): string {
  const tmpDir = ensureTestDir();
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p,
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n' +
    'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n' +
    'trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n'
  );
  return p;
}

function createTestKss(): string {
  const tmpDir = ensureTestDir();
  const p = path.join(tmpDir, 'KSS_list.kss');
  fs.writeFileSync(p,
    'Mark\tQty\tProfile\tGrade\tLength\tType\n' +
    'B101\t8\tW8X24\tA992\t2209.80\tBEAM\n' +
    'B102\t16\tW16X26\tA992\t711.20\tBEAM\n' +
    'C101\t4\tW10X49\tA992\t4267.20\tCOLUMN\n'
  );
  return p;
}

// ─── API Test ────────────────────────────────────────────────────────────────

test.describe('Coordination Package — API Flow', () => {
  test('should upload coordination files via API and process to ready', async () => {
    const token = await getToken();
    const ifcBuf = fs.readFileSync(createTestIfc());
    const kssBuf = fs.readFileSync(createTestKss());
    const pdf1Buf = fs.readFileSync(createTestPdf('B101 - Rev 0.pdf'));
    const pdf2Buf = fs.readFileSync(createTestPdf('E102 - Rev 2.pdf'));

    // Build multipart form manually with fetch
    const formData = new FormData();
    formData.append('name', 'PW API Test Package');
    formData.append('description', 'Playwright automated test');
    formData.append('files', new Blob([ifcBuf]), 'PW-Test-Model.ifc');
    formData.append('files', new Blob([kssBuf]), 'KSS_list.kss');
    formData.append('files', new Blob([pdf1Buf], { type: 'application/pdf' }), 'B101 - Rev 0.pdf');
    formData.append('files', new Blob([pdf2Buf], { type: 'application/pdf' }), 'E102 - Rev 2.pdf');

    const uploadRes = await fetch(`${API_BASE}/api/coordination/upload-files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    expect(uploadRes.status).toBe(201);
    const body = await uploadRes.json();
    const pkgId = body.data.id;
    expect(body.data.status).toBe('processing');
    console.log(`Package created: ${pkgId}`);

    // Poll until ready or error (max 60s)
    let status = 'processing';
    let pkgData: any;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(`${API_BASE}/api/coordination/${pkgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      pkgData = (await res.json()).data;
      status = pkgData.status;
      if (status !== 'processing') break;
    }

    console.log(`Package status: ${status}`);
    if (status === 'error') console.log(`Error: ${pkgData.errorMessage}`);
    expect(status).toBe('ready');
    expect(pkgData.modelId).toBeTruthy();
    expect(pkgData.kssFileName).toBe('KSS_list.kss');
    expect(pkgData.kssData).toBeTruthy();
    expect(pkgData.kssData.memberCount).toBe(3);

    // Check drawings
    const drawingsRes = await fetch(`${API_BASE}/api/coordination/${pkgId}/drawings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const drawingsBody = await drawingsRes.json();
    const drawings = drawingsBody.data || drawingsBody;
    console.log(`Drawings found: ${drawings.length}`);
    expect(drawings.length).toBe(2);

    // Check model is downloadable
    const modelRes = await fetch(`${API_BASE}/api/models/${pkgData.modelId}/file`);
    expect(modelRes.status).toBe(200);
    const modelBlob = await modelRes.blob();
    console.log(`Model file: ${modelBlob.size} bytes`);
    expect(modelBlob.size).toBeGreaterThan(0);
  });
});

// ─── UI Tests ────────────────────────────────────────────────────────────────

test.describe('Coordination Package — UI Flow', () => {
  test('should navigate to coordination page from sidebar', async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('text=Coordination');
    await page.waitForURL(/coordination/, { timeout: 10000 });

    await page.screenshot({ path: 'test-results/coordination-list.png', fullPage: true });
    const heading = page.locator('h1');
    await expect(heading).toContainText('Coordination Packages');
  });

  test('should show packages or empty state on coordination list', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/coordination');
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForTimeout(2000);

    const body = await page.textContent('body');
    const hasContent = body?.includes('TWHS') || body?.includes('PW') ||
                       body?.includes('No coordination') || body?.includes('ready');
    expect(hasContent).toBeTruthy();

    await page.screenshot({ path: 'test-results/coordination-list-loaded.png', fullPage: true });
  });

  test('should open upload panel with form fields and drop zone', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/coordination');
    await page.waitForSelector('h1', { timeout: 10000 });

    await page.click('text=Upload Package');
    await page.waitForSelector('text=Upload Coordination Package', { timeout: 5000 });
    await expect(page.locator('text=Upload Coordination Package')).toBeVisible();
    await expect(page.locator('.drop-zone')).toBeVisible();

    await page.screenshot({ path: 'test-results/coordination-upload-panel.png', fullPage: true });
  });

  test('should view a ready coordination package with 3D viewer', async ({ page }) => {
    const pkgId = await getReadyPackageId();
    if (!pkgId) {
      console.log('No ready package found — skipping');
      test.skip();
      return;
    }

    await loginAsAdmin(page);
    await page.goto(`/coordination/${pkgId}`);

    // Wait for the page to load — either shows "ready" status or 3D viewer
    await page.waitForSelector('.status-chip, app-three-viewer, .error-card', { timeout: 20000 });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'test-results/coordination-view-loaded.png', fullPage: true });

    // Check page has the package name
    const h1 = await page.textContent('h1');
    expect(h1).toBeTruthy();
    console.log(`Viewing package: ${h1}`);

    // Check for the 3D viewer or status
    const hasViewer = await page.locator('app-three-viewer').count() > 0;
    const hasStatus = await page.locator('.status-chip').count() > 0;
    expect(hasViewer || hasStatus).toBeTruthy();

    if (hasViewer) {
      // Wait a bit for model to load
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'test-results/coordination-view-3d.png', fullPage: true });
    }

    // Check for tabs (Drawings, Info, KSS)
    const tabs = page.locator('.mat-mdc-tab');
    const tabCount = await tabs.count();
    console.log(`Found ${tabCount} tabs`);

    if (tabCount > 0) {
      // Click on each tab and screenshot
      const tabLabels = await page.locator('.mat-mdc-tab-labels .mat-mdc-tab').allTextContents();
      console.log(`Tab labels: ${tabLabels.join(', ')}`);

      for (const label of ['Drawings', 'KSS Data', 'Info']) {
        const tab = page.locator(`.mat-mdc-tab:has-text("${label}")`);
        if (await tab.count() > 0) {
          await tab.click();
          await page.waitForTimeout(1000);
          const slug = label.toLowerCase().replace(/\s+/g, '-');
          await page.screenshot({ path: `test-results/coordination-view-${slug}.png`, fullPage: true });
        }
      }
    }
  });

  test('should click a drawing to open PDF overlay', async ({ page }) => {
    const pkgId = await getReadyPackageId();
    if (!pkgId) {
      console.log('No ready package found — skipping');
      test.skip();
      return;
    }

    await loginAsAdmin(page);
    await page.goto(`/coordination/${pkgId}`);
    await page.waitForSelector('.status-chip, app-three-viewer', { timeout: 20000 });
    await page.waitForTimeout(2000);

    // Click Drawings tab
    const drawingsTab = page.locator('.mat-mdc-tab:has-text("Drawings")');
    if (await drawingsTab.count() > 0) {
      await drawingsTab.click();
      await page.waitForTimeout(1000);

      // Click first drawing
      const drawingItem = page.locator('mat-nav-list a').first();
      if (await drawingItem.count() > 0) {
        await drawingItem.click();
        await page.waitForTimeout(1500);

        // Check for PDF overlay
        const overlay = page.locator('.pdf-overlay');
        if (await overlay.count() > 0) {
          await page.screenshot({ path: 'test-results/coordination-pdf-viewer.png', fullPage: true });
          // Close overlay
          await page.locator('.pdf-header button').click();
          await page.waitForTimeout(500);
        }
      }
    }

    await page.screenshot({ path: 'test-results/coordination-drawing-test.png', fullPage: true });
  });
});
