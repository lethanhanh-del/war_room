import { useState } from 'react';

export default function AccessKeyGate({ onSubmit, hadKey }) {
  const [key, setKey] = useState('');
  return (
    <div className="gate">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) onSubmit(key.trim());
        }}
      >
        <h2>War Room</h2>
        <p className="muted">
          {hadKey ? 'Access key không đúng hoặc đã thay đổi. ' : ''}
          Nhập access key do quản trị viên cung cấp để truy cập.
        </p>
        <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Access key" autoFocus />
        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn primary" type="submit">Truy cập</button>
        </div>
      </form>
    </div>
  );
}
