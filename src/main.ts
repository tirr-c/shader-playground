import { mat4, quat, vec3 } from 'wgpu-matrix';

const shaderUrls = {
  common: new URL('./assets/shaders/common.wgsl', import.meta.url),
  shadow: new URL('./assets/shaders/shadow.wgsl', import.meta.url),
  vert: new URL('./assets/shaders/vert.wgsl', import.meta.url),
  frag: new URL('./assets/shaders/frag.wgsl', import.meta.url),
};
const boxTextureUrl = new URL('./assets/box.png', import.meta.url);

const hostVertexData = new Float32Array([
  // position, n, uv_or_color
  // front
  -1, 1, 1, 1,    0, 0, 1, 0,   0, 0, 0, -1,
  1, 1, 1, 1,     0, 0, 1, 0,   1, 0, 0, -1,
  -1, -1, 1, 1,   0, 0, 1, 0,   0, 1, 0, -1,
  1, -1, 1, 1,    0, 0, 1, 0,   1, 1, 0, -1,
  // right
  1, 1, 1, 1,     1, 0, 0, 0,   0, 0, 0, -1,
  1, 1, -1, 1,    1, 0, 0, 0,   1, 0, 0, -1,
  1, -1, 1, 1,    1, 0, 0, 0,   0, 1, 0, -1,
  1, -1, -1, 1,   1, 0, 0, 0,   1, 1, 0, -1,
  // back
  1, 1, -1, 1,    0, 0, -1, 0,  0, 0, 0, -1,
  -1, 1, -1, 1,   0, 0, -1, 0,  1, 0, 0, -1,
  1, -1, -1, 1,   0, 0, -1, 0,  0, 1, 0, -1,
  -1, -1, -1, 1,  0, 0, -1, 0,  1, 1, 0, -1,
  // left
  -1, 1, -1, 1,   -1, 0, 0, 0,  0, 0, 0, -1,
  -1, 1, 1, 1,    -1, 0, 0, 0,  1, 0, 0, -1,
  -1, -1, -1, 1,  -1, 0, 0, 0,  0, 1, 0, -1,
  -1, -1, 1, 1,   -1, 0, 0, 0,  1, 1, 0, -1,
  // top
  -1, 1, -1, 1,   0, 1, 0, 0,   0, 0, 0, -1,
  1, 1, -1, 1,    0, 1, 0, 0,   1, 0, 0, -1,
  -1, 1, 1, 1,    0, 1, 0, 0,   0, 1, 0, -1,
  1, 1, 1, 1,     0, 1, 0, 0,   1, 1, 0, -1,
  // bottom
  -1, -1, 1, 1,   0, -1, 0, 0,  0, 0, 0, -1,
  1, -1, 1, 1,    0, -1, 0, 0,  1, 0, 0, -1,
  -1, -1, -1, 1,  0, -1, 0, 0,  0, 1, 0, -1,
  1, -1, -1, 1,   0, -1, 0, 0,  1, 1, 0, -1,
]);
const hostIndexData = new Uint16Array([
  // front
  2, 1, 0, 1, 2, 3,
  // right
  6, 5, 4, 5, 6, 7,
  // back
  10, 9, 8, 9, 10, 11,
  // left
  14, 13, 12, 13, 14, 15,
  // top
  18, 17, 16, 17, 18, 19,
  // bottom
  22, 21, 20, 21, 22, 23,
]);

const hostFloorVertexData = new Float32Array([
  // position, n, uv_or_color
  -1, 0, -1, 1,   0, 1, 0, 0,   1, 1, 1, 1,
  1, 0, -1, 1,    0, 1, 0, 0,   1, 1, 1, 1,
  -1, 0, 1, 1,    0, 1, 0, 0,   1, 1, 1, 1,
  1, 0, 1, 1,     0, 1, 0, 0,   1, 1, 1, 1,
]);
const hostFloorIndexData = new Uint16Array([
  2, 1, 0, 1, 2, 3,
]);

if (!navigator.gpu) {
  throw new Error('WebGPU not supported');
}

let adapter;
try {
  adapter = await navigator.gpu.requestAdapter();
} catch (e) {
  console.error(e);
}
if (adapter == null) {
  throw new Error('Could not request WebGPU adapter');
}

const preferredFormat = navigator.gpu.getPreferredCanvasFormat();

const device = await adapter.requestDevice();

const shaderEntries = await Promise.all(
  Object.entries(shaderUrls).map(async ([key, url]) => {
    const resp = await fetch(url);
    return [key, await resp.text()] as const;
  }),
);
const shaders = Object.fromEntries(shaderEntries);
const shadowShaderModule = device.createShaderModule({
  code: shaders.common + shaders.shadow,
});
const vertShaderModule = device.createShaderModule({
  code: shaders.common + shaders.vert,
});
const fragShaderModule = device.createShaderModule({
  code: shaders.common + shaders.frag,
});

const boxTexturePromise = loadTexture(device);

const gpuVertexData = device.createBuffer({
  size: hostVertexData.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(gpuVertexData, 0, hostVertexData);

const gpuIndexData = device.createBuffer({
  size: hostIndexData.byteLength,
  usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(gpuIndexData, 0, hostIndexData);

const gpuFloorVertexData = device.createBuffer({
  size: hostFloorVertexData.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(gpuFloorVertexData, 0, hostFloorVertexData);

const gpuFloorIndexData = device.createBuffer({
  size: hostFloorIndexData.byteLength,
  usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(gpuFloorIndexData, 0, hostFloorIndexData);

const gpuUniformObjectsData = device.createBuffer({
  // 4x4 matrix of f32
  size: 4 * 4 * 4,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const gpuUniformFloorObjectsData = device.createBuffer({
  // 4x4 matrix of f32
  size: 4 * 4 * 4,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const gpuUniformGlobalData = device.createBuffer({
  // 4x4 matrix of f32 x3 (view_mat, proj_mat)
  size: 4 * 4 * 4 * 2,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const maxPointLights = 4;
const gpuPointLightsData = Array(maxPointLights).fill(null).map(() => (
  device.createBuffer({
    size: 28 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
));

const shadowVertexBufferSpec = [
  {
    attributes: [
      {
        shaderLocation: 0,
        offset: 0,
        format: 'float32x4',
      },
    ],
    arrayStride: 4 * (4 + 4 + 4),
    stepMode: 'vertex',
  },
] satisfies GPUVertexBufferLayout[];

const vertexBufferSpec = [
  {
    attributes: [
      {
        shaderLocation: 0,
        offset: 0,
        format: 'float32x4',
      },
      {
        shaderLocation: 1,
        offset: 16,
        format: 'float32x4',
      },
      {
        shaderLocation: 2,
        offset: 32,
        format: 'float32x4',
      },
    ],
    arrayStride: 4 * (4 + 4 + 4),
    stepMode: 'vertex',
  },
] satisfies GPUVertexBufferLayout[];

const shadowPipeline = device.createRenderPipeline({
  label: 'shadow',
  vertex: {
    module: shadowShaderModule,
    entryPoint: 'main',
    buffers: shadowVertexBufferSpec,
  },
  primitive: {
    topology: 'triangle-list',
    cullMode: 'back',
  },
  depthStencil: {
    depthWriteEnabled: true,
    depthCompare: 'less',
    format: 'depth32float',
  },
  layout: 'auto',
});

const bglObject = device.createBindGroupLayout({
  label: 'object',
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {
        type: 'uniform',
      },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      texture: {
        sampleType: 'float',
      },
    },
    {
      binding: 2,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      sampler: {
        type: 'filtering',
      },
    },
  ],
});

const bglGlobal = device.createBindGroupLayout({
  label: 'global',
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {
        type: 'uniform',
      },
    },
  ],
});

const bglLight = device.createBindGroupLayout({
  label: 'light',
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {
        type: 'uniform',
      },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      texture: {
        sampleType: 'depth',
      },
    },
    {
      binding: 2,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      sampler: {
        type: 'comparison',
      },
    },
  ],
});

const renderPipeline = device.createRenderPipeline({
  label: 'scene',
  vertex: {
    module: vertShaderModule,
    entryPoint: 'main',
    buffers: vertexBufferSpec,
  },
  fragment: {
    module: fragShaderModule,
    entryPoint: 'main',
    targets: [
      {
        format: preferredFormat,
        blend: {
          alpha: {
            operation: 'add',
            dstFactor: 'zero',
            srcFactor: 'one',
          },
          color: {
            operation: 'add',
            dstFactor: 'one',
            srcFactor: 'one',
          },
        },
      },
    ],
  },
  primitive: {
    topology: 'triangle-list',
    cullMode: 'back',
  },
  depthStencil: {
    depthWriteEnabled: true,
    depthCompare: 'less',
    format: 'depth24plus',
  },
  multisample: {
    count: 4,
  },
  layout: device.createPipelineLayout({
    bindGroupLayouts: [bglObject, bglGlobal, bglLight],
  }),
});

const boxTexture = await boxTexturePromise;

const shadowBindGroupObjects = [gpuUniformObjectsData, gpuUniformFloorObjectsData].map(objects => {
  return device.createBindGroup({
    layout: shadowPipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: objects,
      },
    ],
  });
});

const bindGroupObjects = [gpuUniformObjectsData, gpuUniformFloorObjectsData].map(objects => {
  return device.createBindGroup({
    layout: bglObject,
    entries: [
      {
        binding: 0,
        resource: objects,
      },
      {
        binding: 1,
        resource: boxTexture,
      },
      {
        binding: 2,
        resource: device.createSampler({
          magFilter: 'linear',
          minFilter: 'linear',
        }),
      },
    ],
  });
});

const shadowBindGroupLights = gpuPointLightsData.map(buffer => (
  device.createBindGroup({
    layout: shadowPipeline.getBindGroupLayout(1),
    entries: [
      {
        binding: 0,
        resource: buffer,
      },
    ],
  })
));

const bindGroupGlobal = device.createBindGroup({
  layout: bglGlobal,
  entries: [
    {
      binding: 0,
      resource: gpuUniformGlobalData,
    },
  ],
});

async function initCanvas() {
  const canvas: HTMLCanvasElement | null = document.querySelector('#output');
  if (canvas == null) {
    throw new Error();
  }

  const context = canvas.getContext('webgpu');
  if (context == null) {
    throw new Error('Cannot happen; we have `navigator.gpu` but not `webgpu` context?');
  }
  context.configure({
    device,
    format: preferredFormat,
    alphaMode: 'premultiplied',
  });

  return { canvas, context };
}

async function loadTexture(device: GPUDevice) {
  const boxTextureResp = await fetch(boxTextureUrl);
  const boxTextureBlob = await boxTextureResp.blob();
  const boxTextureImg = await createImageBitmap(boxTextureBlob);

  const boxTexture = device.createTexture({
    format: 'rgba8unorm',
    size: [boxTextureImg.width, boxTextureImg.height, 1],
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture(
    { source: boxTextureImg },
    { texture: boxTexture },
    [boxTextureImg.width, boxTextureImg.height],
  );

  return boxTexture;
}

function createTextures(width: number, height: number, opt?: { numShadows?: number }) {
  const texture = device.createTexture({
    size: [width, height],
    format: preferredFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    sampleCount: 4,
  });
  const depth = device.createTexture({
    size: [width, height],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    sampleCount: 4,
  });
  const shadowDepth = Array(opt?.numShadows ?? 0).fill(null).map(() => (
    device.createTexture({
      size: [1024, 1024, 1],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
  ));
  return { texture, depth, shadowDepth };
}

const { canvas, context } = await initCanvas();

let currentWidth = canvas.width;
let currentHeight = canvas.height;
let oldTextures: GPUTexture[] = [];
let { texture, depth, shadowDepth } = createTextures(currentWidth, currentHeight, { numShadows: gpuPointLightsData.length });
if (!shadowDepth) {
  throw new Error();
}

const shadowDepthViews = shadowDepth.map(texture => texture.createView());
const bindGroupPointLights: GPUBindGroup[] = [];
const sampler = device.createSampler({ compare: 'less' });
for (let i = 0; i < shadowDepth.length; i++) {
  bindGroupPointLights.push(device.createBindGroup({
    layout: bglLight,
    entries: [
      {
        binding: 0,
        resource: gpuPointLightsData[i],
      },
      {
        binding: 1,
        resource: shadowDepthViews[i],
      },
      {
        binding: 2,
        resource: sampler,
      },
    ],
  }));
}

const lights = [
  {
    viewMat: mat4.lookAt([0, 5, 0], [0, 0, 0], [1, 0, 0]),
    halfTheta: Math.PI / 6,
    colorIntensity: [40, 40, 40],
  },
  {
    viewMat: mat4.lookAt([2, 3, 2], [0, -3, 0], [0, 1, 0]),
    halfTheta: Math.PI / 8,
    colorIntensity: [30, 40, 40],
  },
  {
    viewMat: mat4.lookAt([-3, 2, 3], [0, -2, 0], [0, 1, 0]),
    halfTheta: Math.PI / 8,
    colorIntensity: [30, 20, 30],
  },
  {
    viewMat: mat4.lookAt([-1, 3, -5], [0, -2, 0], [0, 1, 0]),
    halfTheta: Math.PI / 8,
    colorIntensity: [40, 40, 20],
  },
];
const numPointLights = lights.length;
for (let i = 0; i < lights.length; i++) {
  const buffer = new Float32Array(28);

  const light = lights[i];
  const viewMatInv = mat4.inverse(light.viewMat);
  const pos = vec3.transformMat4([0, 0, 0], viewMatInv);
  const dir = vec3.transformMat4Upper3x3([0, 0, -1], viewMatInv);
  const projMat = mat4.perspective(light.halfTheta * 2, 1, 0.1, 20);
  const viewProjMat = mat4.multiply(projMat, light.viewMat);

  buffer.set(pos, 0);
  buffer.set(dir, 4);
  buffer[7] = light.halfTheta;
  buffer.set(light.colorIntensity, 8);
  buffer.set(viewProjMat, 12);

  device.queue.writeBuffer(gpuPointLightsData[i], 0, buffer);
}

class TimestampQueryManager {
  public querySet: GPUQuerySet;
  public buffer: GPUBuffer;
  public mappableBuffer: GPUBuffer;

  constructor() {
    this.querySet = device.createQuerySet({
      type: 'timestamp',
      count: 2 * numPointLights * 2,
    });

    this.buffer = device.createBuffer({
      size: (2 * numPointLights * 2) * 8,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });

    this.mappableBuffer = device.createBuffer({
      size: (2 * numPointLights * 2) * 8,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  async retrieveAndShowTimestamps(info: HTMLElement) {
    if (this.mappableBuffer.mapState !== 'unmapped') {
      return;
    }

    await this.mappableBuffer.mapAsync(GPUMapMode.READ);
    const buffer = this.mappableBuffer.getMappedRange();
    const timestamps = new BigInt64Array(buffer);

    try {
      info.innerHTML = '';
      for (let i = 0; i < timestamps.length; i += 2) {
        const begin = timestamps[i];
        const end = timestamps[i + 1];
        const elapsedNs = Number(end - begin);
        const node = document.createElement('div');
        node.textContent = `render #${i / 2}: ${elapsedNs} ns`;
        info.appendChild(node);
      }
    } finally {
      this.mappableBuffer.unmap();
    }
  }

}

const infoNode = document.getElementById('info');
let timestampManager: TimestampQueryManager | undefined;
if (device.features.has('timestamp-query')) {
  timestampManager = new TimestampQueryManager();
} else if (infoNode) {
  infoNode.textContent = 'timestamp query not supported';
}

const shadowPassDescriptor = {
  colorAttachments: [],
  depthStencilAttachment: {
    depthLoadOp: 'clear',
    depthStoreOp: 'store',
    depthClearValue: 1.0,
    view: shadowDepthViews[0],
  },
  timestampWrites: undefined as GPURenderPassTimestampWrites | undefined,
} satisfies GPURenderPassDescriptor;

const renderPassDescriptor = {
  colorAttachments: [
    {
      loadOp: 'clear' as 'clear' | 'load',
      storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      view: texture.createView(),
      resolveTarget: undefined as GPUTextureView | undefined,
    },
  ],
  depthStencilAttachment: {
    depthLoadOp: 'clear',
    depthStoreOp: 'store',
    depthClearValue: 1.0,
    view: depth.createView(),
  },
  timestampWrites: undefined as GPURenderPassTimestampWrites | undefined,
} satisfies GPURenderPassDescriptor;

const ro = new ResizeObserver(entries => {
  for (const entry of entries) {
    if (entry.target === canvas) {
      const width = entry.devicePixelContentBoxSize[0].inlineSize;
      const height = entry.devicePixelContentBoxSize[0].blockSize;
      if (currentWidth === width && currentHeight === height) {
        continue;
      }

      currentWidth = width;
      currentHeight = height;

      oldTextures = [texture, depth];
      ({ texture, depth } = createTextures(width, height));
      renderPassDescriptor.colorAttachments[0].view = texture.createView();
      renderPassDescriptor.depthStencilAttachment.view = depth.createView();
    }
  }
});
ro.observe(canvas, { box: 'device-pixel-content-box' });

function createShadowBundle(bgLight: GPUBindGroup): GPURenderBundle {
  const shadowBundleEncoder = device.createRenderBundleEncoder({
    label: `render bundle for light '${bgLight.label}'`,
    colorFormats: [],
    depthStencilFormat: 'depth32float',
    stencilReadOnly: true,
  });
  shadowBundleEncoder.setPipeline(shadowPipeline);
  shadowBundleEncoder.setBindGroup(0, shadowBindGroupObjects[0]);
  shadowBundleEncoder.setBindGroup(1, bgLight);
  shadowBundleEncoder.setVertexBuffer(0, gpuVertexData);
  shadowBundleEncoder.setIndexBuffer(gpuIndexData, 'uint16');
  shadowBundleEncoder.drawIndexed(36);
  shadowBundleEncoder.setBindGroup(0, shadowBindGroupObjects[1]);
  shadowBundleEncoder.setVertexBuffer(0, gpuFloorVertexData);
  shadowBundleEncoder.setIndexBuffer(gpuFloorIndexData, 'uint16');
  shadowBundleEncoder.drawIndexed(6);
  return shadowBundleEncoder.finish();
}

const shadowRenderBundles = shadowBindGroupLights.map(createShadowBundle);

const beginTime = performance.now();
function render() {
  canvas.width = currentWidth;
  canvas.height = currentHeight;

  const timeElapsed = (performance.now() - beginTime) / 1000;
  const modelRot = quat.identity();
  const modelRotVal = timeElapsed / 3;
  quat.rotateX(modelRot, Math.cos(modelRotVal) * Math.PI / 2, modelRot);
  quat.rotateY(modelRot, Math.sin(modelRotVal) * Math.PI / 2, modelRot);
  const viewMat = mat4.lookAt([0, 6, 5], [0, 0, 0], [0, 1, 0]);
  const projMat = mat4.perspective(Math.PI / 3, (canvas.width / canvas.height), 0.5, 50);
  const objectMat = mat4.fromQuat(modelRot);
  const floorObjectMat = mat4.multiply(mat4.translation([0, -4, 0]), mat4.scaling([5, 5, 5]));

  device.queue.writeBuffer(
    gpuUniformObjectsData,
    0,
    objectMat.buffer,
    objectMat.byteOffset,
    objectMat.byteLength,
  );
  device.queue.writeBuffer(
    gpuUniformFloorObjectsData,
    0,
    floorObjectMat.buffer,
    floorObjectMat.byteOffset,
    floorObjectMat.byteLength,
  );
  device.queue.writeBuffer(
    gpuUniformGlobalData,
    0,
    viewMat.buffer,
    viewMat.byteOffset,
    viewMat.byteLength,
  );
  device.queue.writeBuffer(
    gpuUniformGlobalData,
    64,
    projMat.buffer,
    projMat.byteOffset,
    projMat.byteLength,
  );

  const commandEncoder = device.createCommandEncoder();

  for (let i = 0; i < numPointLights; i++) {
    shadowPassDescriptor.depthStencilAttachment.view = shadowDepthViews[i];
    if (timestampManager) {
      shadowPassDescriptor.timestampWrites = {
        querySet: timestampManager.querySet,
        beginningOfPassWriteIndex: 2 * i,
        endOfPassWriteIndex: 2 * i + 1,
      };
    }

    const passEncoder = commandEncoder.beginRenderPass(shadowPassDescriptor);
    passEncoder.executeBundles([shadowRenderBundles[i]]);
    passEncoder.end();
  }

  const timestampQueryIndexBase = 2 * numPointLights;
  {
    renderPassDescriptor.colorAttachments[0].resolveTarget = context.getCurrentTexture().createView();
    for (let i = 0; i < numPointLights; i++) {
      if (timestampManager) {
        renderPassDescriptor.timestampWrites = {
          querySet: timestampManager.querySet,
          beginningOfPassWriteIndex: timestampQueryIndexBase + 2 * i,
          endOfPassWriteIndex: timestampQueryIndexBase + 2 * i + 1,
        };
      }

      if (i === 0) {
        renderPassDescriptor.colorAttachments[0].loadOp = 'clear';
      } else {
        renderPassDescriptor.colorAttachments[0].loadOp = 'load';
      }
      const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
      passEncoder.setPipeline(renderPipeline);

      passEncoder.setBindGroup(1, bindGroupGlobal);
      passEncoder.setBindGroup(2, bindGroupPointLights[i]);

      passEncoder.setBindGroup(0, bindGroupObjects[0]);
      passEncoder.setVertexBuffer(0, gpuVertexData);
      passEncoder.setIndexBuffer(gpuIndexData, 'uint16');
      passEncoder.drawIndexed(36);
      passEncoder.setBindGroup(0, bindGroupObjects[1]);
      passEncoder.setVertexBuffer(0, gpuFloorVertexData);
      passEncoder.setIndexBuffer(gpuFloorIndexData, 'uint16');
      passEncoder.drawIndexed(6);

      passEncoder.end();
    }
  }

  if (timestampManager) {
    commandEncoder.resolveQuerySet(
      timestampManager.querySet,
      0,
      timestampManager.querySet.count,
      timestampManager.buffer,
      0,
    );

    if (timestampManager.mappableBuffer.mapState === 'unmapped') {
      commandEncoder.copyBufferToBuffer(
        timestampManager.buffer,
        timestampManager.mappableBuffer,
      );
    }
  }

  const commandBuffer = commandEncoder.finish();
  device.queue.submit([commandBuffer]);

  if (infoNode) {
    timestampManager?.retrieveAndShowTimestamps(infoNode);
  }

  for (const t of oldTextures) {
    t.destroy();
  }
  oldTextures = [];

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
