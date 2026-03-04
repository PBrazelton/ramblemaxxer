/**
 * app.js — Phusion Passenger entry point for CPanel hosting.
 *
 * Namecheap CPanel expects a file named `app.js` in the app root
 * when configuring a Node.js app via Passenger.
 *
 * This file simply re-exports the Express server.
 */

process.env.NODE_ENV = "production";
require("./server/index.js");
