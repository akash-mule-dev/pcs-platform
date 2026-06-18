import type { DriveStep } from 'driver.js';

/**
 * A registered in-app tour. Steps are built lazily (a function) so element
 * anchors are queried against the live DOM at run time, not registration time.
 */
export interface TourDefinition {
  /** Stable id — also the localStorage seen-flag key and the launcher input. */
  id: string;
  /** Human label (launcher tooltip / Help-&-tours menu). */
  label: string;
  /** Bump to re-surface an updated tour to users who already saw the old one. */
  version: string;
  /**
   * Predicate: is this (page) tour relevant to the current URL? Used by the
   * Help menu to list contextual tours. Omit for GLOBAL tours (e.g. onboarding),
   * which are always offered regardless of route.
   */
  match?: (url: string) => boolean;
  /** Optional extra gate for AUTO-start, on top of the shared audience rules. */
  eligible?: () => boolean;
  /** Built fresh each run; missing element anchors are filtered out by the service. */
  steps: () => DriveStep[];
}

/** Path without query/fragment — keeps route matchers simple. */
const path = (url: string): string => url.split(/[?#]/)[0];

/**
 * Built-in tours. Page-level tours anchor on `[data-tour="…"]` markers placed in
 * the relevant component templates; the service drops any step whose anchor isn't
 * currently in the DOM, so a tour degrades gracefully on empty states / mobile.
 */
export const BUILTIN_TOURS: TourDefinition[] = [
  // ── Global first-run onboarding (launched from the toolbar + auto on first login) ──
  {
    id: 'onboarding',
    label: 'Take a tour',
    version: 'v1',
    steps: () => [
      {
        popover: {
          title: 'Welcome to FabriXR 👋',
          description:
            'A quick 60-second tour of how work flows through the platform — from a design package all the way to a shipped load. You can replay it anytime.',
        },
      },
      {
        element: '.sidenav',
        popover: {
          title: 'Your main menu',
          description:
            'Everything lives here, grouped by area — Production, Shop Floor, Materials, Quality, Engineering and more. The groups expand and collapse.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="/projects"]',
        popover: {
          title: '1 · Projects — where every job starts',
          description:
            'Create a project, then import an IFC or ZIP package — the assembly tree and 3D model build automatically. Inside a project you create <b>production orders</b>, step pieces through the <b>stage board</b>, and <b>ship</b> them.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="/package-monitor"]',
        popover: {
          title: '2 · Package Monitor',
          description:
            'Watch your IFC/ZIP imports run live — queue position, current stage and progress — across the whole company.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="/work-orders"]',
        popover: {
          title: '3 · Work Orders',
          description:
            'Releasing an order generates the fabrication tasks — one work order per assembly, driven through your process stages.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="/work-orders/kanban"]',
        popover: {
          title: '4 · Kanban — where is every piece?',
          description:
            'A company-wide board: each card sits at its first incomplete stage. Record progress and complete stages right from here.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="global-search"]',
        popover: {
          title: 'Find anything fast',
          description: 'Jump straight to any work order or user from global search.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="support"]',
        popover: {
          title: 'Need a hand?',
          description:
            'Open Help / Support to raise a ticket — our team replies right here in the app.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="tour-launcher"]',
        popover: {
          title: "That's the tour! 🛠️",
          description: 'Replay this walkthrough anytime from here. Happy fabricating.',
          side: 'bottom',
          align: 'end',
        },
      },
    ],
  },

  // ── Projects list page ──
  {
    id: 'projects',
    label: 'Tour: Projects',
    version: 'v1',
    match: (u) => path(u) === '/projects',
    steps: () => [
      {
        element: '[data-tour="proj-new"]',
        popover: {
          title: 'Create a job',
          description:
            'Start a fabrication project here. The wizard lets you upload an IFC/ZIP package straight away — its assembly tree and 3D model build in the background.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="proj-monitor"]',
        popover: {
          title: 'Live import pipelines',
          description: 'Package Monitor tracks every import across all projects — queue position and progress in real time.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="proj-search"]',
        popover: {
          title: 'Find a project',
          description: 'Filter the list by name, job number or client.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="proj-row"]',
        popover: {
          title: 'Open a project',
          description:
            'Click any project to open its workspace — assembly tree, 3D model, production orders and shipping all live inside.',
          side: 'bottom',
          align: 'start',
        },
      },
    ],
  },

  // ── Inside a project (workspace shell — header is present on every project sub-route) ──
  {
    id: 'project-workspace',
    label: 'Tour: this project',
    version: 'v1',
    match: (u) => /^\/projects\/[^/]+/.test(path(u)),
    steps: () => [
      {
        element: '[data-tour="ws-import"]',
        popover: {
          title: 'Import a package',
          description:
            'Upload IFC, a CAD/mesh file, or a ZIP coordination package (model + drawings). The file is stored safely first, then the assembly tree + 3D model build automatically.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="ws-stats"]',
        popover: {
          title: 'Design at a glance',
          description: 'Assemblies, parts, total weight and how many work orders this design is driving.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="ws-tabs"]',
        popover: {
          title: 'Everything for this job',
          description:
            'Overview, Assemblies & 3D, Work Orders and Monitoring. Create <b>production orders</b> under Work Orders — then track the board, progress, quality and shipping inside each order.',
          side: 'bottom',
          align: 'start',
        },
      },
    ],
  },

  // ── Stage Kanban ──
  {
    id: 'kanban',
    label: 'Tour: Kanban board',
    version: 'v1',
    match: (u) => path(u).startsWith('/work-orders/kanban'),
    steps: () => [
      {
        element: '[data-tour="kanban-filters"]',
        popover: {
          title: 'Focus the board',
          description: 'Narrow to a project, a single order, or search by piece mark / work order.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="kanban-board"]',
        popover: {
          title: 'Where is every piece?',
          description:
            'Columns are your process stages. Each card is a work order sitting at its <b>first incomplete stage</b>, and moves automatically as work is recorded.',
          side: 'top',
          align: 'start',
        },
      },
      {
        element: '[data-tour="kanban-board"] .card',
        popover: {
          title: 'Record progress here',
          description:
            '<b>+1</b> records one more piece through the current stage; <b>✓</b> completes the stage for all pieces. Quality gates (open NCRs) are enforced server-side.',
          side: 'right',
          align: 'start',
        },
      },
    ],
  },

  // ── Package Monitor (tenant-wide import pipeline) ──
  {
    id: 'package-monitor',
    label: 'Tour: Package Monitor',
    version: 'v1',
    match: (u) => path(u).startsWith('/package-monitor'),
    steps: () => [
      {
        element: '[data-tour="pm-kpis"]',
        popover: {
          title: 'The pipeline at a glance',
          description:
            'Across your whole organization: how many packages are processing now, waiting in the queue, completed today, and any failures.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="pm-tabs"]',
        popover: {
          title: 'In progress vs history',
          description:
            '<b>In progress</b> shows each package\'s live stage, % and queue position. <b>History</b> is every upload ever — filter by project, sort, and retry failed imports.',
          side: 'bottom',
          align: 'start',
        },
      },
    ],
  },

  // ── Materials & Inventory ──
  {
    id: 'materials',
    label: 'Tour: Inventory',
    version: 'v1',
    match: (u) => path(u) === '/materials',
    steps: () => [
      {
        element: '[data-tour="mat-kpis"]',
        popover: {
          title: 'Stock at a glance',
          description: 'Material count, total stock value (moving-average cost) and how many items are below their reorder level.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="mat-new"]',
        popover: {
          title: 'Add a material',
          description:
            'A master\'s <b>profile + grade</b> link it to imported assembly parts — that match drives project material requirements and one-click issuing.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="mat-filters"]',
        popover: {
          title: 'Find & manage stock',
          description:
            'Search or filter to low-stock only. Pick a material to receive (re-averages cost), return, adjust, and read its full movement ledger.',
          side: 'bottom',
          align: 'start',
        },
      },
    ],
  },

  // ── Order workspace shell (the per-order tabs) ──
  {
    id: 'order-workspace',
    label: 'Tour: this order',
    version: 'v1',
    match: (u) => /^\/projects\/[^/]+\/orders\/[^/]+/.test(path(u)),
    steps: () => [
      {
        element: '[data-tour="ow-head"]',
        popover: {
          title: 'One production order',
          description: 'Its status, customer, quantity and due date. Released orders generate the work that flows across the tabs below.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="ow-tabs"]',
        popover: {
          title: 'Track it end to end',
          description:
            '<b>Board</b> steps pieces through stages, <b>Progress</b> rolls it up, <b>Materials</b> issues stock, <b>Costs</b> compares actual vs estimate, <b>Quality</b> handles NCRs, and <b>Shipping</b> loads it out.',
          side: 'bottom',
          align: 'start',
        },
      },
    ],
  },

  // ── Production board (a single order's stage board) ──
  {
    id: 'order-board',
    label: 'Tour: production board',
    version: 'v1',
    match: (u) => /\/orders\/[^/]+\/board/.test(path(u)),
    steps: () => [
      {
        element: '[data-tour="board-search"]',
        popover: {
          title: 'Find an item',
          description: 'Search by piece mark or tag — handy when an order has hundreds of pieces.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="board-columns"]',
        popover: {
          title: 'Stages, left to right',
          description:
            'Each column is a process stage; the cards are this order\'s pieces. Pieces flow rightward as you record work, and land in <b>Done</b> when every stage is complete.',
          side: 'top',
          align: 'start',
        },
      },
      {
        element: '[data-tour="board-columns"] .step',
        popover: {
          title: 'Record production',
          description:
            '<b>+ / −</b> step one piece, <b>All</b> completes the stage for every piece, <b>Reset</b> sets it back. Taps are optimistic — record fast, nothing is lost.',
          side: 'top',
          align: 'start',
        },
      },
    ],
  },
];
