/**
 * English strings for the extracted surfaces: auth, the booking flow and
 * errors. Everything else still lives inline in its screen — see lib/i18n for
 * why that is deliberate rather than unfinished.
 *
 * Keys are namespaced by surface so a translator can be handed one section at
 * a time. Values are the exact strings the app shows today; nothing here is
 * new copy.
 */
export default {
  auth: {
    signIn: 'Sign in',
    signUp: 'Create account',
    email: 'Email',
    password: 'Password',
    firstName: 'First name',
    lastName: 'Last name',
    phone: 'Phone number',
    forgotPassword: 'Forgot password?',
    continue: 'Continue',
    codeSent: 'We sent a 6-digit code to {{email}}.',
    codePrompt: 'Enter the code',
    resendCode: 'Send it again',
    termsPrefix: 'By continuing you agree to our',
    terms: 'Terms of Service',
    and: 'and',
    privacy: 'Privacy Policy',
  },

  booking: {
    occasionAndDate: 'Occasion & date',
    whatsTheMoment: "What's the moment?",
    pickADay: 'Pick a day',
    pickATime: 'Pick a time',
    durationAndPackage: 'Duration & package',
    whereToMeet: 'Where should we meet you?',
    yourCreator: 'Your creator',
    orderSummary: 'Order summary',
    continue: 'Continue',
    bookedWindow: 'Sessions can be booked up to {{days}} days ahead.',
    pickDayFirst: 'Pick a day to see open times.',
    noTimesLeft: 'No times left this day — try another date.',
    slotTaken: 'That time was just taken',
    changeDateOrDetails: 'Change date or details',
    backToSummary: 'Back to summary',
    changeOtherDetails: 'Change other details first',
  },

  errors: {
    generic: 'Something went wrong',
    genericBody:
      'The app hit an unexpected error. Your data is safe — try again, and if it keeps happening, let us know via Help & support.',
    tryAgain: 'Try again',
    offline: "Couldn't load — check your connection.",
    loadFailedTitle: "Couldn't load this",
    saveFailed: "Couldn't save that — try again.",
    downloadFailed: "Couldn't download that file — check your connection, then try again.",
    sendFailed: 'Not sent — check your connection, then tap send again.',
    paymentFailed: 'Payment failed — try again.',
    noConnection: "Can't reach the server right now.",
  },
} as const;
