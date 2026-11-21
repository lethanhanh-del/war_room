// Endpoint CRUD task
//   GET    /api/tasks            -> danh sách task
//   POST   /api/tasks            -> tạo task (body JSON)
//   PUT    /api/tasks?id=<id>    -> cập nhật task (body JSON, chỉ cần các trường thay đổi)
//   DELETE /api/tasks?id=<id>    -> xoá task
import { getRepo } from './_lib/sheets.js';
import { validateTask, ValidationError } from './_lib/schema.js';
import { checkAccess, getBody, handleError, send } from './_lib/http.js';

function getId(req) {
  const id = req.query?.id ?? new URL(req.url, 'http://x').searchParams.get('id');
  if (!id || typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new ValidationError('Thiếu hoặc sai tham số id');
  }
  return id;
}

export default async function handler(req, res) {
  if (!checkAccess(req, res)) return;
  const repo = getRepo();
  try {
    switch (req.method) {
      case 'GET': {
        const tasks = await repo.list();
        return send(res, 200, { data: tasks });
      }
      case 'POST': {
        const input = validateTask(getBody(req));
        const task = await repo.create(input);
        return send(res, 201, { data: task });
      }
      case 'PUT':
      case 'PATCH': {
        const id = getId(req);
        const patch = validateTask(getBody(req), { partial: true });
        const task = await repo.update(id, patch);
        return send(res, 200, { data: task });
      }
      case 'DELETE': {
        const id = getId(req);
        await repo.remove(id);
        return send(res, 200, { data: { id } });
      }
      default:
        res.setHeader('Allow', 'GET, POST, PUT, PATCH, DELETE');
        return send(res, 405, { error: 'Method không được hỗ trợ' });
    }
  } catch (err) {
    return handleError(res, err);
  }
}
