const { buildSchema } = require('graphql');

const schema = buildSchema(`
  type Appointment {
    id: ID!
    user_id: ID!
    patient_id: ID!
    pm_appointment_id: String
    appointment_date: String
    provider_name: String
    status: String
  }

  type Patient {
    id: ID!
    user_id: ID!
    pm_patient_id: String
    first_name: String
    last_name: String
    date_of_birth: String
  }

  type PatientInsuranceRow {
    id: ID!
    patient_id: ID!
    coverage_rank: Int
    payer_name: String
    member_id: String
    plan_name: String
    pm_patient_id: String
  }

  type AvailityRow {
    run_id: ID
    patient_id: ID
    pm_patient_id: String
    run_status: String
    is_active: Boolean
    coverage_status_text: String
    benefit_line: String
  }

  type Dashboard {
    appointmentCount: Int!
    patientCount: Int!
    insuranceRowCount: Int!
    availityRowCount: Int!
  }

  type Query {
    """Aggregated counts for the authenticated user (from JWT)"""
    dashboard: Dashboard!
  }
`);

module.exports = { schema };
