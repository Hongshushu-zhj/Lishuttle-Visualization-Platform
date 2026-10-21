// 栅格以 DEM 原始行序保存:首行为地图上方。数值纹理只上传一次。
export function decodeRaster(preview) {
  const binary = atob(preview.data);
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) view.setUint8(i, binary.charCodeAt(i));
  const values = new Float32Array(preview.width * preview.height);
  for (let i = 0; i < values.length; i++) {
    const raw = view.getInt16(i * 2, true);
    values[i] = raw === preview.invalid || (preview.zeroIsInvalid && raw === 0) ? -1e20 : raw / preview.divisor;
  }
  return values;
}

export function jet(t, reverse = true) {
  const x = reverse ? 1 - t : t;
  const channel = (offset) => Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - offset))));
  return [channel(3), channel(2), channel(1)];
}

export function createRasterPainter(preview, useGpu = true) {
  const values = decodeRaster(preview);
  const canvas = document.createElement('canvas');
  canvas.width = preview.width; canvas.height = preview.height;
  let gl = useGpu ? canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: false }) : null;
  let program, texture, buffer;
  if (gl) {
    try {
      function shader(type, source) {
        const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      }
      program = gl.createProgram();
      const vertex = shader(gl.VERTEX_SHADER, `#version 300 es
        in vec2 position; out vec2 uv;
        void main(){ uv=vec2((position.x+1.0)/2.0,(1.0-position.y)/2.0);gl_Position=vec4(position,0,1); }`);
      const fragment = shader(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float; uniform sampler2D raster; uniform vec2 limits; uniform bool reverseColor;
        in vec2 uv; out vec4 color;
        void main(){float value=texture(raster,uv).r;if(value < -1e19){color=vec4(0);return;}
        float t=clamp((value-limits.x)/(limits.y-limits.x),0.0,1.0);if(reverseColor)t=1.0-t;
        vec3 rgb=clamp(vec3(1.5)-abs(4.0*t-vec3(3,2,1)),0.0,1.0);color=vec4(rgb,1);}`);
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, preview.width, preview.height, 0, gl.RED, gl.FLOAT, values);
      gl.uniform1i(gl.getUniformLocation(program, 'raster'), 0);
      gl.uniform1i(gl.getUniformLocation(program, 'reverseColor'), !preview.categorical);
    } catch {
      gl.getExtension('WEBGL_lose_context')?.loseContext(); gl = null;
    }
  }
  // 不支持 WebGL2 的机器仍可使用本地 Canvas 调色,不回退到 MATLAB。
  const fallback = gl ? null : document.createElement('canvas');
  if (fallback) { fallback.width = preview.width; fallback.height = preview.height; }
  return {
    mode: gl ? 'WebGL' : 'Canvas',
    paint(range) {
      if (gl && !gl.isContextLost()) {
        gl.uniform2f(gl.getUniformLocation(program, 'limits'), ...range);
        gl.viewport(0, 0, preview.width, preview.height); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return canvas;
      }
      if (!fallback) throw new Error('图形上下文已失效,请关闭预览后重新打开');
      const ctx = fallback.getContext('2d'); const image = ctx.createImageData(preview.width, preview.height);
      const palette = Array.from({ length: 1024 }, (_, i) => jet(i / 1023, !preview.categorical));
      for (let i = 0; i < values.length; i++) {
        if (values[i] < -1e19) continue;
        const t = Math.max(0, Math.min(1, (values[i] - range[0]) / (range[1] - range[0])));
        const color = palette[Math.round(t * 1023)], offset = i * 4;
        image.data[offset] = color[0]; image.data[offset + 1] = color[1];
        image.data[offset + 2] = color[2]; image.data[offset + 3] = 255;
      }
      ctx.putImageData(image, 0, 0); return fallback;
    },
    dispose() {
      if (gl) { gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.getExtension('WEBGL_lose_context')?.loseContext(); }
    },
  };
}

export function drawPreview(canvas, painter, preview, figure, range) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const b = preview.bounds;
  const [left, right] = figure.xlim || [b.left, b.right];
  const [bottom, top] = figure.ylim || [b.bottom, b.top];
  const scale = Math.min((W - 250) / (right - left), (H - 190) / (top - bottom));
  const width = (right - left) * scale, height = (top - bottom) * scale;
  const x0 = 100 + ((W - 250) - width) / 2, y0 = 90 + ((H - 190) - height) / 2;
  const x = (v) => x0 + (v - left) * scale, y = (v) => y0 + (top - v) * scale;
  ctx.font = 'bold 19px "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#20252d';
  ctx.fillText(`${figure.sourceName} · 任务 ${figure.taskName} · ${figure.dataType} · ${figure.layerLabel}`, W / 2, 30, W - 24);
  ctx.font = '14px "Microsoft YaHei", sans-serif';
  ctx.fillText(`交互预览 · 色标 ${range[0]} ～ ${range[1]} ${preview.unit}${preview.sampled ? ' · 已采样' : ''}`, W / 2, 56);
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, width, height); ctx.clip();
  const e = preview.extent;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(painter.paint(range), x(e.left), y(e.top), (e.right - e.left) * scale, (e.top - e.bottom) * scale);
  ctx.lineWidth = 1.2; ctx.strokeStyle = '#333';
  for (const wall of preview.overlays.walls) {
    ctx.beginPath(); ctx.moveTo(x(wall[0]), y(wall[1])); ctx.lineTo(x(wall[2]), y(wall[3])); ctx.stroke();
  }
  ctx.strokeStyle = '#808080';
  for (const building of preview.overlays.buildings) {
    ctx.beginPath(); building.points.forEach(([px, py], i) => i ? ctx.lineTo(x(px), y(py)) : ctx.moveTo(x(px), y(py))); ctx.stroke();
    if (building.height > 30 && building.points.length) {
      ctx.fillStyle = '#b55'; ctx.font = '12px sans-serif'; ctx.fillText(building.height, x(building.points[0][0]), y(building.points[0][1]));
    }
  }
  for (const cell of preview.overlays.cells) {
    ctx.beginPath(); ctx.arc(x(cell.x), y(cell.y), 5, 0, 2 * Math.PI); ctx.fillStyle = '#00a7a7'; ctx.fill(); ctx.strokeStyle = '#006666'; ctx.stroke();
  }
  ctx.restore(); ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, width, height);
  const mode = figure.coordMode || 'abs';
  const origin = mode === 'rel-ll' ? [left, bottom] : mode === 'rel-center' ? [(left + right) / 2, (bottom + top) / 2] : [0, 0];
  const fmt = (value) => Number(value.toFixed(2)).toString();
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#333';
  for (let i = 0; i <= 4; i++) {
    const px = x0 + i * width / 4, py = y0 + height - i * height / 4;
    ctx.textAlign = 'center'; ctx.fillText(fmt(left + i * (right - left) / 4 - origin[0]), px, y0 + height + 23);
    ctx.textAlign = 'right'; ctx.fillText(fmt(bottom + i * (top - bottom) / 4 - origin[1]), x0 - 9, py + 4);
  }
  ctx.textAlign = 'center'; ctx.fillText('X (m)', x0 + width / 2, y0 + height + 47);
  ctx.save(); ctx.translate(24, y0 + height / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('Y (m)', 0, 0); ctx.restore();
  if (mode !== 'abs') ctx.fillText(`相对坐标原点 (${fmt(origin[0])}, ${fmt(origin[1])}) m`, W / 2, H - 14);
  const barX = x0 + width + 28, barY = y0, barH = height;
  for (let i = 0; i < 256; i++) {
    ctx.fillStyle = `rgb(${jet(1 - i / 255, !preview.categorical).join(',')})`;
    ctx.fillRect(barX, barY + i * barH / 256, 20, barH / 256 + 1);
  }
  ctx.strokeStyle = '#555'; ctx.strokeRect(barX, barY, 20, barH);
  ctx.font = '12px sans-serif'; ctx.fillStyle = '#333'; ctx.textAlign = 'left';
  for (let i = 0; i <= 4; i++) ctx.fillText(fmt(range[1] - i * (range[1] - range[0]) / 4), barX + 27, barY + i * barH / 4 + 4);
  ctx.fillText(preview.unit, barX - 2, barY - 14);
}
