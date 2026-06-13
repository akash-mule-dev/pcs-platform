/**
 * Pure support-ticket workflow — statuses, categories, priorities and the
 * transition rules. No Nest/TypeORM imports, so it's unit-testable and the
 * client can mirror the option lists via the /api/support/meta endpoint.
 */

export const TICKET_STATUSES = ['open', 'in_progress', 'pending', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_CATEGORIES = ['bug', 'question', 'feature_request', 'billing', 'other'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export type MessageAuthorKind = 'customer' | 'support' | 'system';

/** Human labels for UI (also served via /meta). */
export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  pending: 'Waiting on customer',
  resolved: 'Resolved',
  closed: 'Closed',
};
export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent',
};
export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  bug: 'Bug / not working', question: 'Question / how-to', feature_request: 'Feature request',
  billing: 'Billing / account', other: 'Other',
};

/** Statuses where the ticket is still being worked. */
const ACTIVE_STATES: ReadonlyArray<TicketStatus> = ['open', 'in_progress', 'pending'];
export function isActive(status: TicketStatus): boolean {
  return ACTIVE_STATES.includes(status);
}
export function isTerminal(status: TicketStatus): boolean {
  return status === 'resolved' || status === 'closed';
}

/** Support-side allowed status transitions (a no-op to the same status is always allowed). */
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'pending', 'resolved', 'closed'],
  in_progress: ['open', 'pending', 'resolved', 'closed'],
  pending: ['open', 'in_progress', 'resolved', 'closed'],
  resolved: ['open', 'in_progress', 'closed'], // reopen / finalize
  closed: ['open', 'in_progress'], // reopen
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isValidStatus(s: string): s is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(s);
}
export function isValidPriority(p: string): p is TicketPriority {
  return (TICKET_PRIORITIES as readonly string[]).includes(p);
}
export function isValidCategory(c: string): c is TicketCategory {
  return (TICKET_CATEGORIES as readonly string[]).includes(c);
}

/**
 * A customer reply re-activates a ticket that was waiting/finished: pending,
 * resolved or closed all return to `open`; otherwise the status is unchanged.
 */
export function statusAfterCustomerReply(current: TicketStatus): TicketStatus {
  return current === 'pending' || current === 'resolved' || current === 'closed' ? 'open' : current;
}

/**
 * Support's first public reply to a brand-new ticket moves it into progress;
 * a reply never silently reopens a resolved/closed ticket (that's an explicit
 * status change).
 */
export function statusAfterSupportReply(current: TicketStatus): TicketStatus {
  return current === 'open' ? 'in_progress' : current;
}
