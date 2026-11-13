# Star Astrology - Consultation Website (dynamic UPI QR payments, WhatsApp for enquiries)

**Rule:** every place that takes a payment uses a **dynamic UPI QR code** (no WhatsApp). Every place that is only an enquiry or a question uses **WhatsApp** (and is also saved on the server).
The site must be opened through the Node.js server in `server/` (not by double-clicking `index.html`), because the server creates the payment orders and QR codes.

## How a payment works
1. Customer presses a pay button (Book Now > PAY NOW, PAY ₹999 NOW, PAY ₹199 NOW, PAY ₹299 NOW).
2. The **server** validates the details, takes the price from `server/packages.json` (the browser can never choose an amount), creates a unique order with the payment gateway (**Cashfree Payments**) and asks it for a UPI QR for exactly that order and amount.
3. The customer sees a payment screen: business name, exact amount, the QR code, a 5-minute countdown, status (Pending / Successful / Failed / Expired), the 6 instructions, **VERIFY PAYMENT**, and (on phones) **PAY WITH UPI APP**.
4. The customer pays in any UPI app. Cashfree tells our server through a **signed webhook** (`/api/webhooks/cashfree`). The server checks the signature, the order, the amount (exact), the currency and that the payment status is SUCCESS, then marks the booking paid exactly once.
5. The screen turns into the green **Successful Payment** card (Transaction ID, amount, UPI, name, masked mobile, booking ID, status) and redirects to the booking confirmation page.
- **VERIFY PAYMENT** never marks anything paid by itself: it makes the *server* ask Cashfree (server-to-server, with the secret key) what happened. This also covers a delayed webhook, and makes local testing possible.
- A QR code is never reused: after it fails or expires, the customer gets a **new gateway order and a new QR** for the same booking. If a payment still arrives on an old QR, it is matched to the right booking and recorded (marked "late payment").
- Each transaction limit: minimum ₹10, maximum ₹5,000 (`server/src/config.js`). The server refuses to take a payment outside this range, and the screen shows "Minimum amount ₹10.00" / "Maximum amount ₹5,000.00" in red.
- There is no screenshot/UTR upload: a screenshot or UTR number is never accepted as proof of payment.

## Run it (Windows / PowerShell)
1. Install Node.js **22.13 or newer**. No Python or Visual Studio is needed.
2. Create a free Cashfree account, open the **Test (Sandbox)** developer dashboard, and copy the App ID and Secret Key (Developers > API Keys). In the same dashboard **enable UPI QR / Order Pay (S2S) for your account** if it is not already on (ask Cashfree support if you cannot find it) and add the webhook below.
3. `cd server`
4. `copy .env.example .env` and fill in `.env`: `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV=sandbox`, `ADMIN_PASSWORD` (10+ characters), `SESSION_SECRET` (long random text).
5. `npm.cmd install` then `npm.cmd start` (use `npm.cmd` if PowerShell blocks `npm`)
6. Open http://localhost:3000 . Admin dashboard: http://localhost:3000/admin

## What is paid
| Where on the site | What | Price comes from |
|---|---|---|
| Book Now (last step, **PAY NOW**) | Consultation packages | `server/packages.json` > `packages` |
| Kundli Making page, **PAY ₹999 NOW** | Kundli Making | `extras` (`kundli-making`) |
| Products page, **PAY ₹199 NOW** | Kundli Consultation offer | `extras` (`offer-199`) |
| Products page, **PAY ₹299 NOW** | Kundli or Palm Reading offer | `extras` (`offer-299`) |

The consultation packages still ship with **test placeholder prices (₹100 / ₹200 / ₹300, `"confirmed": false`)**: set your real prices and `"confirmed": true` before going live (in Live Mode an unconfirmed price cannot be paid). Prices must be whole rupees between ₹10 and ₹5,000.

## WhatsApp (enquiries only, no payment)
WhatsApp number: `CFG.wa` near the top of the script in `index.html` (currently 919004629005).
- Floating green WhatsApp button (all pages) and the footer WhatsApp button.
- **Contact** form and **Products enquiry** form: on submit, WhatsApp opens with the details filled in, and the enquiry is also saved on the server (admin dashboard > **Enquiries**), so it is not lost if the visitor does not press Send.
- WhatsApp buttons on the Products page (header bar, "Enquire on WhatsApp", "Check my stone"), the contact boxes and the policy pages.
- Not used on: Book Now, Kundli Making (PAY ₹999 NOW), the ₹199 / ₹299 pay buttons and the pay dialog.

## Admin dashboard (`/admin`)
Customer name, mobile, booking ID, transaction ID, amount, date/time, payment method and status for every payment; filters Paid / Pending / Failed / Expired / Refunded, search, date range, a per-payment log (payment history) and **Download CSV** transaction report. Old Razorpay-era rows stay visible.

## Webhook (automatic confirmation)
Cashfree Dashboard > Developers > Webhooks > add the URL `https://your-domain/api/webhooks/cashfree` (HTTPS) and tick the **Payment** events (success, failed, user dropped) and **Refund status**. The server verifies Cashfree's signature (`x-webhook-signature` with your Secret Key) and rejects anything else. Set `PUBLIC_URL=https://your-domain` in `.env` too, so every order also carries this URL.
On your own computer (localhost) Cashfree cannot reach you, so confirmation happens through **VERIFY PAYMENT** (and the screen's automatic checks). Use the Sandbox for this.

## Going live
1. Complete Cashfree KYC, switch the dashboard to Production, put the **Production** keys in `.env` and set `CASHFREE_ENV=production` and `PUBLIC_URL=https://your-domain`. Create the webhook again in Production. Keep the Secret Key only on the server.
2. Set real consultation prices with `"confirmed": true`.
3. Host it where Node.js runs **with a persistent disk** (VPS, or Render/Railway with a disk). The database is `server/data/bookings.db`; back it up. Use HTTPS and set `TRUST_PROXY=1` behind a proxy.
4. Policy pages were updated to describe online UPI payment through Cashfree and stored details. Have them reviewed (ideally with legal advice) before launch.
5. If the server or Cashfree is unavailable, the pay buttons show "Online payment is not available right now" and the phone number. Payment buttons never fall back to WhatsApp.

## Other settings
- Phone: +91 90046 29005 (footer, call buttons). Instagram / Facebook links and the map card are in the footer.
- Package names, durations and time slots: `server/packages.json` (the site reads them from the server).
- Pandit details, testimonials, reels: see the settings block near the top of the script in `index.html`.
- Mobile numbers: digits only, 10 digits, must start with 6-9; fake numbers are rejected on the site and on the server.

## Tests
`cd server && npm.cmd test` runs the backend tests.

## Payments (UPI QR + screenshot, no gateway)
No Cashfree or any payment API is used.
1. The customer presses PAY NOW (booking, Kundli Making or the Rs 199/299 offers). Your QR (`images/upi-qr.png`) opens.
2. They scan it, type the amount in their UPI app and pay.
3. They upload the payment screenshot. It is saved on the server and WhatsApp opens with a ready message to +91 90046 29005.
4. You see every payment and its screenshot at `/admin/manual` (log in at `/admin`). Press Approve after checking your UPI app.
To change the QR, replace `images/upi-qr.png` (use a large, sharp image). To change the WhatsApp number, edit `var WA` in `index.html`.

## First-time FREE CHAT with the astrologer
- **Where:** homepage button **FREE CHAT WITH ASTROLOGER** opens the page at `#freechat` (birth details, Vedic Rashi, problem area and description).
- **Submit:** the browser sends the form to `POST /api/free-chat`. The server validates everything again, saves the registration, and only then the page opens WhatsApp (`CFG.wa`, the same number as the rest of the site) with the prefilled message. The message contains the line `THIS IS MY FIRST CHAT`.
- **One free chat per mobile number:** the number is normalised to 10 digits (`+91`, `0` and spaces are ignored) and stored in the `free_chats` table, which has a `UNIQUE` constraint on `mobile`. This is checked on the server, so refreshing, clearing history, private windows or another device cannot bypass it, and two simultaneous submissions cannot both succeed. Nothing is kept in localStorage or cookies.
- **Returning number:** shows "Your Free Chat Has Already Been Used" with a **CONTINUE WITH PAID CONSULTATION** button to Book Now. WhatsApp is not opened.
- **The registration is kept even if the client never presses Send in WhatsApp.** That number cannot register again.
- **Admin:** `/admin` now has a **Free Chat Enquiries** table (search, and a status you can set to registered / contacted / completed).
- **Code:** `server/src/freechat.js` (table, validation, route), two small hooks in `server/src/app.js` and `server/src/admin.js`, and the new page and script in `index.html`.
- To reset a number (for example after a mistake), delete its row in the `free_chats` table of `server/data/bookings.db`.


## Update: paid first chat
The free chat form was removed. The site now offers a paid **First Chat with Astrologer for ₹149** (hero button and the offers section on the Products page). It uses the same UPI QR payment and screenshot flow as the other offers. Old free chat registrations remain visible in the admin dashboard.

The ₹149 First Chat opens a details form (name, mobile, date, time and place of birth, Rashi, problem area and description), then the same UPI QR pay window. After the payment screenshot is uploaded, WhatsApp opens with all details, the payment reference and the first-chat marker. The details are also saved with the payment in the admin dashboard.
