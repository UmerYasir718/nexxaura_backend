const { __test } = require('../src/playwright/officeAllyClient');

describe('officeAlly patient visits parser', () => {
  it('extracts visit id and visit date rows from patient visits grid html', () => {
    const html = `
      <table id="ctl00_phFolderContent_myCustomGrid_myGrid">
        <tbody>
          <tr role="row">
            <td aria-describedby="ctl00_phFolderContent_myCustomGrid_myGrid_ID">412334</td>
            <td aria-describedby="ctl00_phFolderContent_myCustomGrid_myGrid_DateVisited">06/30/2025</td>
          </tr>
          <tr role="row">
            <td aria-describedby="ctl00_phFolderContent_myCustomGrid_myGrid_ID">412335</td>
            <td aria-describedby="ctl00_phFolderContent_myCustomGrid_myGrid_DateVisited">07/01/2025</td>
          </tr>
        </tbody>
      </table>
    `;

    const rows = __test.parsePatientVisitsFromHtml(html);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      pmVisitId: '412334',
      visitDate: '06/30/2025',
    });
    expect(rows[1]).toMatchObject({
      pmVisitId: '412335',
      visitDate: '07/01/2025',
    });
  });

  it('returns empty when no DateVisited cells exist', () => {
    const html = `
      <table>
        <tbody>
          <tr role="row">
            <td aria-describedby="some_other_cell">N/A</td>
          </tr>
        </tbody>
      </table>
    `;
    expect(__test.parsePatientVisitsFromHtml(html)).toEqual([]);
  });
});
