// GET / POST /api/waiting-point -> đồng bộ mốc đếm ngược & thống kê "Vừa hoàn thành" theo ngày giữa các màn hình.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { send, getBody, handleError } from './_lib/http.js';
import { emptyWaitingPointState, mergeWaitingPointState, getTodayKey } from './_lib/waitingPointSync.js';

const STATE_FILE = path.join(os.tmpdir(), 'warroom-waiting-point-state.json');
let memState = null;

function ensureNormalized(raw) {
  // Chạy qua mergeWaitingPointState với incoming rỗng để đảm bảo nâng cấp historyByDate & đúng ngày hôm nay
  return mergeWaitingPointState(raw, {}, Date.now());
}

function readState() {
  if (memState) {
    if (memState.date !== getTodayKey()) {
      memState = ensureNormalized(memState);
    }
    return memState;
  }
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        memState = ensureNormalized(parsed);
        return memState;
      }
    }
  } catch {
    // ignore corrupted tmp cache
  }
  memState = emptyWaitingPointState();
  return memState;
}

function writeState(next) {
  memState = next;
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(next), 'utf8');
  } catch {
    // Trên môi trường read-only vẫn hoạt động bình thường qua bộ nhớ
  }
}

export default function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return send(res, 200, readState());
    }
    if (req.method === 'POST') {
      const body = getBody(req);
      const next = mergeWaitingPointState(readState(), body && typeof body === 'object' ? body : {});
      writeState(next);
      return send(res, 200, next);
    }
    return send(res, 405, { error: 'Chỉ hỗ trợ GET và POST' });
  } catch (err) {
    handleError(res, err);
  }
}
