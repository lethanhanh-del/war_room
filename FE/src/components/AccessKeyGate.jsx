import { useState } from 'react';

export default function AccessKeyGate({ onSubmit, hadKey }) {
  const [key, setKey] = useState('');
  return (
    <div className="gate">
      <form
        className="gate-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) onSubmit(key.trim());
        }}
      >
        <h1>WAR ROOM</h1>
        <p>
          {hadKey ? 'Access key không đúng hoặc đã thay đổi. ' : ''}
          Nhập access key do quản trị viên cung cấp.
        </p>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Access key" autoFocus />
        <button type="submit">Truy cập</button>
      </form>
    </div>
  );
}
