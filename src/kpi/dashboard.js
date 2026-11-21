// Dữ liệu cho màn hình War Room dòng tiền ở trang "/" (app React của Thành Anh, thư mục FE/).
//
// App gọi GET /api/dashboard. Trên Vercel, FE/api/ đọc Google Sheet bằng Service Account. Ở Worker, dữ liệu lấy từ
// cùng nguồn với trang /kpi (Google Sheet KPI đã đồng bộ vào D1, xem index.js) rồi đổi sang đúng định dạng app đọc:
//   { spreadsheetTitle, generatedAt, mode, today,
//     flows: [{ key, label, sheet, sheetTitle, days: ['YYYY-MM-DD'], groups: [{ key, stt, name, lead }],
//               items: [{ row, stt, groupKey, group, lead, kpi, pic, note, folder, placeholder?, days: [{ date, task, done }] }] }] }
// Mỗi dòng KPI của 1 người là 1 item: task = nội dung ô KPI của ngày, done = ô Kết quả Đạt / đã tick.
// App tự tính Đạt / Không đạt / Đang làm / Chưa đến hạn theo ngày hôm nay (FE/src/lib/status.js).

/** Tên ô dòng tiền: tên tab task ("Dòng tiền bán 4 dự án"); tên viết hoa toàn bộ thì đổi sang dạng câu. */
export function flowLabel(stream) {
  const sheet = String(stream.sheet || '').replace(/\s+/g, ' ').trim();
  const t = /^dòng tiền\b/i.test(sheet) ? sheet : `Dòng tiền ${stream.name || sheet}`.trim();
  if (t !== t.toLocaleUpperCase('vi')) return t;
  const lower = t.toLocaleLowerCase('vi');
  return lower.charAt(0).toLocaleUpperCase('vi') + lower.slice(1);
}

/** Dữ liệu /api/kpi (kpiData) -> dữ liệu /api/dashboard cho app React. */
export function toDashboard(data) {
  const flows = (data.streams || []).map((s) => {
    const days = (s.days || []).map((d) => d.date);
    const groups = [];
    const items = [];
    (s.groups || []).forEach((g, gi) => {
      const key = `${s.key}-${gi + 1}`;
      const stt = String(gi + 1);
      const lead = g.pic?.name || '';
      groups.push({ key, stt, name: g.name, lead });
      const base = { stt, groupKey: key, group: g.name, lead };
      if (!g.rows?.length) {
        items.push({ ...base, row: 0, kpi: '', pic: lead, note: '', folder: '', placeholder: true, days: days.map((date) => ({ date, task: null, done: null })) });
        return;
      }
      for (const r of g.rows) {
        const cells = r.cells || {};
        const dayVals = days.map((date) => {
          const c = cells[date];
          return { date, task: c?.kpi || null, done: c ? c.res === 'D' : null };
        });
        const first = dayVals.find((d) => d.task);
        items.push({
          ...base,
          row: r.row,
          kpi: first ? first.task : '',
          pic: r.person || lead,
          note: r.note || '',
          folder: r.folder || r.folderText || '',
          // Người chưa có KPI ngày nào: app hiện "Chưa có dòng KPI" để thấy ai chưa được giao.
          ...(Object.keys(cells).length ? {} : { placeholder: true }),
          days: dayVals,
        });
      }
    });
    return { key: s.key, label: flowLabel(s), sheet: s.kpiSheet || s.sheet || '', sheetTitle: s.sheet || '', days, groups, items };
  });
  return {
    spreadsheetTitle: 'Google Sheet KPI',
    generatedAt: data.source?.changedAt || data.source?.checkedAt || new Date(data.now || Date.now()).toISOString(),
    mode: 'google-sheets',
    today: data.today,
    flows,
  };
}
