/**
 * Messages, inside the creator tab group.
 *
 * The thread list is identical for both sides of a booking — the same
 * roster endpoint, the same rows — so this is the SAME screen, not a
 * creator-flavoured copy of it. Re-exported rather than reimplemented so a
 * fix to threads reaches creators automatically.
 *
 * It exists as a route only because expo-router tabs must be children of
 * their own group: a tab cannot point at a screen in the (app) group.
 */
export { default } from '../(app)/messages/index';
