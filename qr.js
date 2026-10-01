(function () {
  'use strict';

  const inviteId = new URLSearchParams(window.location.search).get('invite') || '';
  const content = document.getElementById('qr-content');
  const error = document.getElementById('error');
  const qrElement = document.getElementById('qrcode');
  const invitationUrl = new URL('./index.html', window.location.href);

  if (!/^[A-Za-z0-9_-]{10,128}$/.test(inviteId)) {
    content.hidden = true;
    error.hidden = false;
    return;
  }

  invitationUrl.searchParams.set('invite', inviteId);
  document.getElementById('open-invitation').href = invitationUrl.toString();

  function renderQr() {
    if (typeof QRCode !== 'function') {
      content.hidden = true;
      error.hidden = false;
      return;
    }

    new QRCode(qrElement, {
      text: invitationUrl.toString(),
      width: 256,
      height: 256,
      colorDark: '#251820',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
  }

  document.getElementById('download-qr').addEventListener('click', function () {
    const canvas = qrElement.querySelector('canvas');
    const image = qrElement.querySelector('img');
    let imageUrl = '';
    if (canvas) imageUrl = canvas.toDataURL('image/png');
    else if (image && image.src) imageUrl = image.src;
    if (!imageUrl) return;

    const download = document.createElement('a');
    download.href = imageUrl;
    download.download = 'Kylie-18th-Invitation-' + inviteId + '.png';
    document.body.appendChild(download);
    download.click();
    download.remove();
  });

  if (typeof QRCode === 'function') renderQr();
  else window.addEventListener('load', renderQr, { once: true });
}());
