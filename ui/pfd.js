/**
 * AERO-Q Primary Flight Display (PFD)
 * Canvas-based 60 FPS military/commercial grade Electronic Flight Instrument System (EFIS).
 */

class PrimaryFlightDisplay {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    
    this.pitch = 0.0;       // degrees (-90 to +90)
    this.roll = 0.0;        // degrees (-180 to +180)
    this.yaw = 0.0;         // degrees (0 to 360)
    this.altitude = 0.0;    // meters
    this.speed = 0.0;       // m/s
    this.climb = 0.0;       // m/s (variometer)
    
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    this.cx = this.width / 2;
    this.cy = this.height / 2;
    
    this.pixelsPerDegreePitch = 3.5;
    
    // Bind render loop
    this.render = this.render.bind(this);
    requestAnimationFrame(this.render);
  }

  updateData(telemetry) {
    if (!telemetry) return;
    this.pitch = telemetry.pitch || 0.0;
    this.roll = telemetry.roll || 0.0;
    this.yaw = telemetry.yaw || 0.0;
    this.altitude = telemetry.alt || 0.0;
    this.speed = telemetry.groundspeed || 0.0;
    this.climb = telemetry.climb || 0.0;

    // Digital readout overlays
    const pitchEl = document.getElementById('pfd-pitch-val');
    const rollEl = document.getElementById('pfd-roll-val');
    const yawEl = document.getElementById('pfd-yaw-val');
    if (pitchEl) pitchEl.textContent = `${this.pitch.toFixed(1)}°`;
    if (rollEl) rollEl.textContent = `${this.roll.toFixed(1)}°`;
    if (yawEl) yawEl.textContent = `${Math.round(this.yaw).toString().padStart(3, '0')}°`;
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cx = this.cx;
    const cy = this.cy;

    ctx.clearRect(0, 0, w, h);

    // 1. Draw Artificial Horizon (Sky / Ground & Pitch Ladder)
    ctx.save();
    // Clip horizon to center window (between speed and alt tapes)
    ctx.beginPath();
    ctx.rect(50, 0, w - 100, h - 35);
    ctx.clip();

    ctx.translate(cx, cy);
    ctx.rotate((-this.roll * Math.PI) / 180);
    const pitchOffset = this.pitch * this.pixelsPerDegreePitch;
    ctx.translate(0, pitchOffset);

    // Sky gradient (Deep tactical cyan/navy)
    const skyGrad = ctx.createLinearGradient(0, -h * 2, 0, 0);
    skyGrad.addColorStop(0, '#001a33');
    skyGrad.addColorStop(1, '#004777');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-w * 2, -h * 2, w * 4, h * 2);

    // Ground gradient (Stealth carbon black)
    const gndGrad = ctx.createLinearGradient(0, 0, 0, h * 2);
    gndGrad.addColorStop(0, '#0a101f');
    gndGrad.addColorStop(1, '#020409');
    ctx.fillStyle = gndGrad;
    ctx.fillRect(-w * 2, 0, w * 4, h * 2);

    // Horizon Line
    ctx.beginPath();
    ctx.moveTo(-w * 2, 0);
    ctx.lineTo(w * 2, 0);
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pitch Ladder Lines
    ctx.font = 'bold 9px "Rajdhani", sans-serif';
    ctx.fillStyle = '#00e5ff';
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.7)';
    ctx.lineWidth = 1.5;

    for (let deg = -30; deg <= 30; deg += 5) {
      if (deg === 0) continue;
      const y = -deg * this.pixelsPerDegreePitch;
      const isMajor = deg % 10 === 0;
      const lineWidth = isMajor ? 38 : 22;

      ctx.beginPath();
      // Left bar
      ctx.moveTo(-lineWidth, y);
      ctx.lineTo(-lineWidth / 3, y);
      if (deg < 0) {
        // Downward tick for negative pitch
        ctx.lineTo(-lineWidth / 3, y - 4);
      }
      // Right bar
      ctx.moveTo(lineWidth / 3, y);
      ctx.lineTo(lineWidth, y);
      if (deg < 0) {
        ctx.lineTo(lineWidth, y - 4);
      }
      ctx.stroke();

      if (isMajor) {
        ctx.textAlign = 'right';
        ctx.fillText(Math.abs(deg).toString(), -lineWidth - 4, y + 3);
        ctx.textAlign = 'left';
        ctx.fillText(Math.abs(deg).toString(), lineWidth + 4, y + 3);
      }
    }
    ctx.restore();

    // 2. Fixed Aircraft Reference Symbol (Central Reticle)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#ffea00';
    ctx.fillStyle = '#ffea00';
    ctx.lineWidth = 2.5;

    // Center dot
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    // Left wing reticle
    ctx.beginPath();
    ctx.moveTo(-45, 0);
    ctx.lineTo(-15, 0);
    ctx.lineTo(-15, 6);
    ctx.stroke();

    // Right wing reticle
    ctx.beginPath();
    ctx.moveTo(45, 0);
    ctx.lineTo(15, 0);
    ctx.lineTo(15, 6);
    ctx.stroke();
    ctx.restore();

    // 3. Roll Arc & Bank Pointer (Top Arc)
    this.drawRollScale(ctx, cx, cy);

    // 4. Airspeed Tape (Left side)
    this.drawSpeedTape(ctx, 0, 0, 50, h - 35, this.speed);

    // 5. Altitude Tape (Right side)
    this.drawAltitudeTape(ctx, w - 50, 0, 50, h - 35, this.altitude, this.climb);

    // 6. Heading Compass Ribbon (Bottom)
    this.drawHeadingTape(ctx, 0, h - 35, w, 35, this.yaw);

    requestAnimationFrame(this.render);
  }

  drawRollScale(ctx, cx, cy) {
    ctx.save();
    const r = 110;
    ctx.beginPath();
    ctx.arc(cx, cy, r, (-150 * Math.PI) / 180, (-30 * Math.PI) / 180);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Ticks at 0, +-10, +-20, +-30, +-45, +-60
    const rollAngles = [0, 10, 20, 30, 45, 60, -10, -20, -30, -45, -60];
    rollAngles.forEach((deg) => {
      const rad = ((-90 + deg) * Math.PI) / 180;
      const len = deg % 30 === 0 ? 10 : 6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(rad) * (r - len), cy + Math.sin(rad) * (r - len));
      ctx.lineTo(cx + Math.cos(rad) * r, cy + Math.sin(rad) * r);
      ctx.strokeStyle = deg === 0 ? '#ffea00' : '#00e5ff';
      ctx.lineWidth = deg === 0 ? 2 : 1;
      ctx.stroke();
    });

    // Roll Pointer (Inverted Triangle moving with bank angle)
    const rollRad = ((-90 - this.roll) * Math.PI) / 180;
    const px = cx + Math.cos(rollRad) * (r - 2);
    const py = cy + Math.sin(rollRad) * (r - 2);

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rollRad + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-4, 7);
    ctx.lineTo(4, 7);
    ctx.closePath();
    ctx.fillStyle = '#ffea00';
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  drawSpeedTape(ctx, x, y, w, h, speed) {
    ctx.save();
    ctx.fillStyle = 'rgba(5, 10, 22, 0.85)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
    ctx.strokeRect(x, y, w, h);

    const midY = h / 2;
    const pxPerUnit = 8;

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 9px "Rajdhani", sans-serif';
    ctx.textAlign = 'right';

    for (let s = Math.floor(speed - 15); s <= speed + 15; s++) {
      if (s < 0) continue;
      const dy = midY - (s - speed) * pxPerUnit;
      if (dy >= 0 && dy <= h) {
        const isMajor = s % 5 === 0;
        ctx.beginPath();
        ctx.moveTo(x + w, dy);
        ctx.lineTo(x + w - (isMajor ? 10 : 5), dy);
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = isMajor ? 1.5 : 1;
        ctx.stroke();

        if (isMajor) {
          ctx.fillText(s.toString(), x + w - 12, dy + 3);
        }
      }
    }

    // Current Speed Box
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(x + 2, midY - 10, w - 4, 20);
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 2, midY - 10, w - 4, 20);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(speed.toFixed(1), x + w / 2, midY + 4);

    ctx.restore();
  }

  drawAltitudeTape(ctx, x, y, w, h, alt, climb) {
    ctx.save();
    ctx.fillStyle = 'rgba(5, 10, 22, 0.85)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
    ctx.strokeRect(x, y, w, h);

    const midY = h / 2;
    const pxPerUnit = 4;

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 9px "Rajdhani", sans-serif';
    ctx.textAlign = 'left';

    for (let a = Math.floor(alt - 30); a <= alt + 30; a++) {
      if (a < 0) continue;
      const dy = midY - (a - alt) * pxPerUnit;
      if (dy >= 0 && dy <= h) {
        const isMajor = a % 10 === 0;
        ctx.beginPath();
        ctx.moveTo(x, dy);
        ctx.lineTo(x + (isMajor ? 10 : 5), dy);
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = isMajor ? 1.5 : 1;
        ctx.stroke();

        if (isMajor) {
          ctx.fillText(a.toString(), x + 12, dy + 3);
        }
      }
    }

    // Current Altitude Box
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(x + 2, midY - 10, w - 4, 20);
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 2, midY - 10, w - 4, 20);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(alt).toString(), x + w / 2, midY + 4);

    ctx.restore();
  }

  drawHeadingTape(ctx, x, y, w, h, yaw) {
    ctx.save();
    ctx.fillStyle = 'rgba(4, 7, 15, 0.95)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
    ctx.strokeRect(x, y, w, h);

    const cx = x + w / 2;
    const pxPerDeg = 2.5;

    ctx.font = 'bold 10px "Orbitron", sans-serif';
    ctx.textAlign = 'center';

    for (let deg = -40; deg <= 40; deg += 5) {
      const heading = (Math.round(yaw) + deg + 360) % 360;
      const dx = cx + deg * pxPerDeg;

      if (dx >= x && dx <= x + w) {
        const isCard = heading % 90 === 0;
        const isTen = heading % 10 === 0;

        ctx.beginPath();
        ctx.moveTo(dx, y);
        ctx.lineTo(dx, y + (isCard ? 10 : isTen ? 6 : 3));
        ctx.strokeStyle = isCard ? '#ffea00' : '#00e5ff';
        ctx.lineWidth = isCard ? 2 : 1;
        ctx.stroke();

        if (isCard) {
          const cardLabels = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
          ctx.fillStyle = '#ffea00';
          ctx.fillText(cardLabels[heading], dx, y + 22);
        } else if (isTen) {
          ctx.fillStyle = '#94a3b8';
          ctx.fillText((heading / 10).toString(), dx, y + 20);
        }
      }
    }

    // Fixed Top Pointer Chevron
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(cx - 5, y + 6);
    ctx.lineTo(cx + 5, y + 6);
    ctx.closePath();
    ctx.fillStyle = '#00e5ff';
    ctx.fill();

    ctx.restore();
  }
}
