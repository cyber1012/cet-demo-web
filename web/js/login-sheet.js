/**
 * 登录浮层（首页与「我的」页共用）
 *
 * 之前「我的」页的登录按钮跳转首页再找按钮，逻辑脆弱导致点了没反应，
 * 改为独立模块，两处都能直接调用。
 */
import { account, toast } from './app.js';

export function showLoginSheet() {
  // 避免重复打开
  if (document.getElementById('loginMask')) return;

  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.id = 'loginMask';

  const sheet = document.createElement('div');
  sheet.className = 'sheet';

  sheet.innerHTML = `
    <h3 class="title mb-xs">登录以保存进度</h3>
    <p class="body muted mb-lg">首次使用会自动注册。进度会同步到云端，换设备也能继续。</p>

    <div id="loginStep1">
      <input class="field mb-md" id="loginEmail" type="email"
             placeholder="你的邮箱" inputmode="email" autocomplete="email" />
      <button class="btn btn-primary btn-block" id="btnSendCode">发送验证码</button>
    </div>

    <div id="loginStep2" style="display:none">
      <p class="caption muted mb-sm">验证码已发到 <span id="loginEmailShow"></span></p>
      <input class="field mb-md" id="loginCode" type="text"
             placeholder="6 位验证码" inputmode="numeric" />
      <button class="btn btn-primary btn-block" id="btnVerify">登录</button>
      <button class="label mt-md" id="btnBack" style="display:block;width:100%;padding:12px">
        换个邮箱
      </button>
    </div>

    <p class="login-err" id="loginErr"></p>
  `;

  document.body.appendChild(mask);
  document.body.appendChild(sheet);

  const close = () => {
    mask.remove();
    sheet.remove();
  };
  mask.addEventListener('click', close);

  let otpVerify = null;
  let otpEmail = '';
  const errEl = sheet.querySelector('#loginErr');
  const showErr = (m) => {
    errEl.textContent = m || '';
  };

  sheet.querySelector('#btnSendCode').addEventListener('click', async () => {
    const email = sheet.querySelector('#loginEmail').value.trim();
    if (!email || !email.includes('@')) return showErr('请输入正确的邮箱');

    const btn = sheet.querySelector('#btnSendCode');
    btn.disabled = true;
    btn.textContent = '发送中…';
    showErr('');
    try {
      const r = await account.sendEmailCode(email);
      otpVerify = r.verify;
      otpEmail = email;
      sheet.querySelector('#loginStep1').style.display = 'none';
      sheet.querySelector('#loginStep2').style.display = 'block';
      sheet.querySelector('#loginEmailShow').textContent = email;
    } catch (e) {
      showErr(e.message || '发送失败，请稍后重试');
    } finally {
      btn.disabled = false;
      btn.textContent = '发送验证码';
    }
  });

  sheet.querySelector('#btnBack').addEventListener('click', () => {
    sheet.querySelector('#loginStep1').style.display = 'block';
    sheet.querySelector('#loginStep2').style.display = 'none';
    otpVerify = null;
    showErr('');
  });

  sheet.querySelector('#btnVerify').addEventListener('click', async () => {
    const code = sheet.querySelector('#loginCode').value.trim();
    if (!code) return showErr('请输入验证码');
    if (!otpVerify) return showErr('验证码已失效，请重新获取');

    const btn = sheet.querySelector('#btnVerify');
    btn.disabled = true;
    btn.textContent = '登录中…';
    showErr('');
    try {
      await account.loginWithEmail(otpEmail, code, otpVerify);
      close();
      toast('登录成功，进度已同步');
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      showErr(e.message || '登录失败，验证码可能已过期');
      btn.disabled = false;
      btn.textContent = '登录';
    }
  });
}