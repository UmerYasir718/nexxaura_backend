jest.mock('axios', () => ({
  post: jest.fn(),
}));

const axios = require('axios');
const env = require('../src/config/env');
if (!String(env.officeAlly.zyteApiKey || '').trim()) {
  env.officeAlly.zyteApiKey = 'jest-test-zyte-key';
}

const { __test } = require('../src/playwright/officeAllyClient');

describe('officeAlly patient visits last-name flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('searches patient visits using PatientLastName and parses visit dates', async () => {
    axios.post.mockResolvedValue({
      data: {
        browserHtml: `
          <table id="ctl00_phFolderContent_myCustomGrid_myGrid">
            <tbody>
              <tr>
                <td aria-describedby="ctl00_phFolderContent_myCustomGrid_myGrid_ID">701122</td>
                <td aria-describedby="ctl00_phFolderContent_myCustomGrid_myGrid_DateVisited">04/27/2026</td>
              </tr>
            </tbody>
          </table>
        `,
      },
    });

    const visits = await __test.requestZytePatientVisitsByPatientLastName({
      officeAllyUsername: 'u',
      officeAllyPassword: 'p',
      patientLastName: "O'Neil",
    });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const payload = axios.post.mock.calls[0][1];
    const evaluateSources = payload.actions
      .filter((a) => a.action === 'evaluate')
      .map((a) => a.source)
      .join('\n');
    expect(evaluateSources).toContain('PatientLastName');
    expect(evaluateSources).toContain("O'Neil");
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({
      pmVisitId: '701122',
      visitDate: '04/27/2026',
    });
  });
});
