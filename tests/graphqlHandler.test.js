jest.mock('../src/services/dataService', () => ({
  getDashboardForUser: jest.fn(),
}));

const { execute, parse } = require('graphql');
const { schema } = require('../src/graphql/schema');
const { buildRootValue } = require('../src/graphql/graphqlHandler');
const dataService = require('../src/services/dataService');

describe('GraphQL dashboard', () => {
  it('returns counts for user', async () => {
    dataService.getDashboardForUser.mockResolvedValue({
      appointments: [1, 2],
      patients: [1],
      patient_insurance: [1, 2, 3],
      availity: [1],
    });
    const req = { user: { id: 'u-1' } };
    const result = await execute({
      schema,
      document: parse(`{ dashboard { appointmentCount patientCount insuranceRowCount availityRowCount } }`),
      rootValue: buildRootValue(req),
    });
    expect(result.errors).toBeUndefined();
    expect(result.data.dashboard).toEqual({
      appointmentCount: 2,
      patientCount: 1,
      insuranceRowCount: 3,
      availityRowCount: 1,
    });
  });
});
