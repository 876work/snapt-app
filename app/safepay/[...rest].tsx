/**
 * Catch-all for the Stripe SDK's own 3D Secure return (snapt://safepay/…).
 *
 * The SDK intercepts this URL and dismisses the challenge browser itself;
 * this route exists purely so expo-router never renders "Unmatched Route"
 * if it also sees the deep link. It shows the same brief holding screen as
 * the legacy stripe-redirect path.
 */
export { default } from '../stripe-redirect';
