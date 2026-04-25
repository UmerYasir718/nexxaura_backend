const { execute, parse } = require('graphql');
const { schema } = require('./schema');
const dataService = require('../services/dataService');

/**
 * @param {import('express').Request} req
 */
function buildRootValue(req) {
  return {
    dashboard: async () => {
      const d = await dataService.getDashboardForUser(req.user.id);
      return {
        appointmentCount: d.appointments.length,
        patientCount: d.patients.length,
        insuranceRowCount: d.patient_insurance.length,
        availityRowCount: d.availity.length,
      };
    },
  };
}

/**
 * GraphQL over HTTP (POST JSON body: { query, variables, operationName })
 */
async function handleGraphql(req, res) {
  const { query, variables, operationName } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ errors: [{ message: 'Missing query' }] });
  }
  try {
    const result = await execute({
      schema,
      document: parse(query),
      variableValues: variables,
      operationName,
      rootValue: buildRootValue(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ errors: [{ message: err.message || String(err) }] });
  }
}

module.exports = { handleGraphql, buildRootValue };
