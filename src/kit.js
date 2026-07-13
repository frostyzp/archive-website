// Kit (ConvertKit) mailing-list signup.
//
// Posts to the public, browser-safe form endpoint that Kit's own ck.js embed
// uses — no API key (that would leak a secret in this static client-only
// build). The numeric form id comes from the form's `action` URL and
// `email_address` is the field name Kit expects. Share link / embed live at:
//   https://synthetic-wisdom-studio.kit.com/84324c404a
const KIT_FORM_ID = '9044171';
const KIT_FORM_ACTION = `https://app.kit.com/forms/${KIT_FORM_ID}/subscriptions`;

function isKitOrigin(origin) {
  try {
    const host = new URL(origin).hostname;
    return (
      host === 'kit.com' ||
      host.endsWith('.kit.com') ||
      host === 'convertkit.com' ||
      host.endsWith('.convertkit.com')
    );
  } catch {
    return false;
  }
}

// Kit's anti-spam "guard": when a submission is quarantined, Kit returns a URL
// for an (almost always invisible) proof-of-work that runs in an iframe on
// Kit's own domain and posts back `ckjs:guard:confirmed` once passed — only
// then is the subscriber recorded. Mirrors ck.js, minus the visible modal.
// Resolves on a timeout too, so a blocked/slow guard never strands the caller.
function passKitGuard(url) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText =
      'position:absolute;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0;';
    iframe.src = url;

    let done = false;
    let timer;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      iframe.remove();
      resolve();
    };
    const onMessage = (e) => {
      if (!isKitOrigin(e.origin)) return;
      if (e.data && e.data.name === 'ckjs:guard:confirmed') finish();
    };

    window.addEventListener('message', onMessage);
    timer = setTimeout(finish, 12000);
    document.body.appendChild(iframe);
  });
}

/**
 * Subscribe an email address to the Kit mailing list. Resolves on success
 * (including Kit's "pending confirmation" double opt-in state); throws an Error
 * with a human-readable message on failure.
 */
export async function subscribeToKit(email) {
  const address = String(email || '').trim();
  if (!address) throw new Error('Please enter your email.');

  // Mirrors ck.js: multipart POST with `email_address` plus the context fields
  // Kit records against the subscriber.
  const body = new FormData();
  body.append('email_address', address);
  body.append('referrer', document.referrer);
  body.append('host', window.location.href);
  body.append('search', window.location.search);

  let res;
  try {
    res = await fetch(KIT_FORM_ACTION, {
      method: 'POST',
      body,
      headers: { Accept: 'application/json', 'X-CKJS-Version': '6' },
    });
  } catch {
    throw new Error('Could not reach the server. Please try again.');
  }
  if (!res.ok) throw new Error('Something went wrong. Please try again.');

  const data = await res.json().catch(() => ({}));
  if (data.status === 'success') return data;
  if (data.status === 'quarantined' && data.url) {
    await passKitGuard(data.url);
    return data;
  }

  throw new Error(
    Array.isArray(data.errors) && data.errors.length
      ? data.errors.join(' ')
      : 'Something went wrong. Please try again.'
  );
}
