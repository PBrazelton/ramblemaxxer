/**
 * server/routes/requirements.js
 * GET /api/requirements           - all program definitions
 * GET /api/requirements/:programId - single program
 */

const express = require("express");
const degreeRequirements = require("../../data/degree_requirements.json");

const router = express.Router();

router.get("/", (req, res) => res.json(degreeRequirements));

router.get("/:programId", (req, res) => {
  const prog = degreeRequirements[req.params.programId];
  if (!prog) return res.status(404).json({ error: "Program not found" });
  res.json(prog);
});

module.exports = router;
