export const PERSONAL_STAFF_ROLE_TITLE = 'Personal Assistant';

/**
 * Fixed job description for every personal staff bot. Not persisted to the
 * DB and not user-editable — the `UpdatePersonalStaffDto` deliberately does
 * not expose `jobDescription`, and the agent-side `UpdateStaffProfile` tool
 * rejects `role` modifications outright for `staffKind: "personal"`. The
 * constant value is what `getStaff` returns and what the persona/avatar
 * generators see as context, so wording matters: frame the assistant as
 * dedicated to one specific owner, not as a generic AI helper.
 */
export const PERSONAL_STAFF_JOB_DESCRIPTION =
  'Dedicated personal assistant for your owner';
