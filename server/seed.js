/**
 * Seeds the demo database: 24 customers, their subscriptions and invoices, and the 40
 * support tickets that double as the labelled evaluation set (labels live in eval/tickets.json).
 *
 * Run: npm run seed
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, persist, run, SCHEMA_SQL } from './db.js';
 
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-09-22';
 
const CUSTOMERS = [
  ['Northwind Retail', 'Maya Chen', 'maya@northwind.example', 'Canada', '2024-03-11', 'growth', 18, 540, 'active'],
  ['Brightleaf Studio', 'Daniel Okafor', 'dan@brightleaf.example', 'United Kingdom', '2024-06-02', 'starter', 4, 96, 'active'],
  ['Kitecraft', 'Arjun Mehta', 'arjun@kitecraft.example', 'India', '2023-11-20', 'scale', 60, 2400, 'active'],
  ['Verde Cafe Group', 'Sofia Rossi', 'sofia@verdecafe.example', 'Italy', '2025-01-15', 'growth', 22, 660, 'past_due'],
  ['Clarke Legal', 'Emma Clarke', 'emma@clarkelegal.example', 'United Kingdom', '2024-09-08', 'starter', 6, 144, 'active'],
  ['Fieldnote', 'Leo Martins', 'leo@fieldnote.example', 'Brazil', '2025-04-30', 'starter', 3, 72, 'cancelled'],
  ['Harborline Trading', 'Priya Nair', 'priya@harborline.example', 'Singapore', '2023-08-14', 'scale', 85, 3400, 'active'],
  ['Copperfield Health', 'James Whitfield', 'james@copperfield.example', 'United States', '2024-01-22', 'scale', 48, 1920, 'active'],
  ['Alpine Logistics', 'Nina Brunner', 'nina@alpinelog.example', 'Switzerland', '2024-11-05', 'growth', 15, 450, 'active'],
  ['Meridian Print', 'Tom Alvarez', 'tom@meridianprint.example', 'United States', '2025-02-18', 'starter', 5, 120, 'past_due'],
  ['Saffron Kitchens', 'Ritu Agarwal', 'ritu@saffronk.example', 'India', '2025-06-01', 'growth', 12, 360, 'active'],
  ['Lakeside Fitness', 'Owen Pratt', 'owen@lakesidefit.example', 'Canada', '2024-05-19', 'starter', 7, 168, 'cancelled'],
  ['Petra Interiors', 'Yasmin Haddad', 'yasmin@petra.example', 'Jordan', '2025-03-07', 'growth', 9, 270, 'active'],
  ['Southbank Media', 'Grace Lombardi', 'grace@southbank.example', 'Australia', '2023-12-03', 'scale', 40, 1600, 'active'],
  ['Orchard Foods', 'Peter Nowak', 'peter@orchardfoods.example', 'Poland', '2024-08-27', 'growth', 20, 600, 'active'],
  ['Tidewater Marine', 'Ana Silva', 'ana@tidewater.example', 'Portugal', '2025-05-12', 'starter', 4, 96, 'active'],
  ['Redwood Analytics', 'Chris Bayer', 'chris@redwoodana.example', 'United States', '2024-02-09', 'scale', 55, 2200, 'past_due'],
  ['Juniper Care', 'Hannah Voss', 'hannah@junipercare.example', 'Germany', '2025-07-21', 'growth', 11, 330, 'active'],
  ['Baytown Rentals', 'Marcus Reid', 'marcus@baytown.example', 'United States', '2024-04-16', 'starter', 3, 72, 'cancelled'],
  ['Kestrel Design', 'Iris Lund', 'iris@kestrel.example', 'Denmark', '2025-08-04', 'starter', 2, 48, 'active'],
  ['Summit Gear', 'Felix Moreau', 'felix@summitgear.example', 'France', '2024-07-11', 'growth', 16, 480, 'active'],
  ['Anchor Freight', 'Diego Santos', 'diego@anchorfreight.example', 'Mexico', '2023-10-02', 'scale', 38, 1520, 'active'],
  ['Willow Tutoring', 'Aisha Bello', 'aisha@willowtutor.example', 'Nigeria', '2025-09-01', 'starter', 2, 48, 'active'],
  ['Granite Build', 'Erik Johansson', 'erik@granitebuild.example', 'Sweden', '2024-10-14', 'growth', 14, 420, 'active'],
];
 
/** @param {string} date @param {number} days @returns {string} */
function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
 
/**
 * Builds a year of invoices per customer, with a realistic mix of paid, open and overdue.
 * @param {number} customerId
 * @param {number} mrr
 * @param {string} status
 * @param {number} nextId
 * @returns {{rows: unknown[][], nextId: number}}
 */
function invoicesFor(customerId, mrr, status, nextId) {
  const rows = [];
  let id = nextId;
  for (let monthsAgo = 6; monthsAgo >= 0; monthsAgo -= 1) {
    const issued = addDays(TODAY, -monthsAgo * 30);
    if (status === 'cancelled' && monthsAgo < 2) continue;
    let state = 'paid';
    if (monthsAgo === 0) state = 'open';
    else if (status === 'past_due' && monthsAgo <= 2) state = 'overdue';
    else if (monthsAgo === 3 && customerId % 7 === 0) state = 'refunded';
    rows.push([id, customerId, issued, addDays(issued, 14), mrr, state]);
    id += 1;
  }
  return { rows, nextId: id };
}
 
const TICKETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval', 'tickets.json'), 'utf8'));
 
/**
 * Builds the demo database from scratch: drops what is there, recreates the schema, inserts
 * customers, subscriptions, invoices and the 40 tickets.
 *
 * Exported rather than run at import time so the API can call it too. The demo is shown to
 * clients repeatedly, and after one run-through every ticket is already triaged — the reset
 * endpoint calls this to put it back to a first-visit state. An ES module only evaluates once
 * per process, so a script with its work at the top level cannot be re-run; a function can.
 *
 * @returns {Promise<{customers: number, invoices: number, tickets: number}>}
 */
export async function seedDatabase() {
  const db = await getDb();
  db.run('DROP TABLE IF EXISTS tickets; DROP TABLE IF EXISTS invoices; DROP TABLE IF EXISTS subscriptions; DROP TABLE IF EXISTS customers;');
  db.run(SCHEMA_SQL);
 
  CUSTOMERS.forEach((c, i) => {
    const [company, contact, email, country, signedUp, plan, seats, mrr, status] = c;
    const id = i + 1;
    run('INSERT INTO customers VALUES (?,?,?,?,?,?)', [id, company, contact, email, country, signedUp]);
    run('INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?)', [
      id, id, plan, seats, mrr, status, signedUp,
      status === 'cancelled' ? addDays(TODAY, -(20 + id)) : null,
    ]);
  });
 
  let invoiceId = 1;
  CUSTOMERS.forEach((c, i) => {
    const { rows, nextId } = invoicesFor(i + 1, c[7], c[8], invoiceId);
    rows.forEach((r) => run('INSERT INTO invoices VALUES (?,?,?,?,?,?)', r));
    invoiceId = nextId;
  });
 
  TICKETS.forEach((t) => {
    run('INSERT INTO tickets (id, customer_id, subject, body, channel, created_at, status) VALUES (?,?,?,?,?,?,?)',
      [t.id, t.customer_id, t.subject, t.body, t.channel, t.created_at, t.status]);
  });
 
  persist();
  return { customers: CUSTOMERS.length, invoices: invoiceId - 1, tickets: TICKETS.length };
}
 
// Run it when this file is executed directly (`npm run seed`), not when the API imports it.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const counts = await seedDatabase();
  console.log(`[seed] ${counts.customers} customers, ${counts.invoices} invoices, ${counts.tickets} tickets written to data/harbordesk.sqlite`);
}
 