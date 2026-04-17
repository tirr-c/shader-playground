import { mat4, quat, vec3 } from 'wgpu-matrix';

const shaderUrls = {
  common: new URL('./assets/shaders/common.wgsl', import.meta.url),
  shadow: new URL('./assets/shaders/shadow.wgsl', import.meta.url),
  gbufferVert: new URL('./assets/shaders/gbuffer-vert.wgsl', import.meta.url),
  gbufferFrag: new URL('./assets/shaders/gbuffer-frag.wgsl', import.meta.url),
  deferredVert: new URL('./assets/shaders/deferred-vert.wgsl', import.meta.url),
  deferredFrag: new URL('./assets/shaders/deferred-frag.wgsl', import.meta.url),
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

const features: GPUFeatureName[] = ['core-features-and-limits'];
if (adapter.features.has('timestamp-query')) {
  features.push('timestamp-query');
}

const preferredFormat = navigator.gpu.getPreferredCanvasFormat();

const device = await adapter.requestDevice({
  requiredFeatures: features,
});

// Shaders
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
const gbufferVertShaderModule = device.createShaderModule({
  code: shaders.common + shaders.gbufferVert,
});
const gbufferFragShaderModule = device.createShaderModule({
  code: shaders.common + shaders.gbufferFrag,
});
const deferredVertShaderModule = device.createShaderModule({
  code: shaders.common + shaders.deferredVert,
});
const deferredFragShaderModule = device.createShaderModule({
  code: shaders.common + shaders.deferredFrag,
});


// Geometry data
const boxTexturePromise = loadTexture(device);

function createGeometry(
  vertices: Float32Array<ArrayBuffer>,
  indices: Uint16Array<ArrayBuffer>,
  label: string,
) {
  const data = {
    label,
    vertices: device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
    indices: device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    }),
  };

  device.queue.writeBuffer(data.vertices, 0, vertices);
  device.queue.writeBuffer(data.indices, 0, indices);

  return data;
}

function createObjectUniformBuffer() {
  return device.createBuffer({
    // 4x4 matrix of f32
    size: 4 * 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

const gpuObjectBuffers = [
  {
    geometry: createGeometry(hostVertexData, hostIndexData, 'box'),
    uniform: createObjectUniformBuffer(),
  },
  {
    geometry: createGeometry(hostFloorVertexData, hostFloorIndexData, 'floor'),
    uniform: createObjectUniformBuffer(),
  },
];


// Storages
const gpuUniformGlobalData = device.createBuffer({
  // 4x4 matrix of f32 x3 (view_mat, view_proj_mat, view_proj_mat_inv)
  size: 4 * 4 * 4 * 3,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const maxPointLights = 4;
const gpuNumPointLights = device.createBuffer({
  size: 4,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const gpuPointLightsData = device.createBuffer({
  size: 256 * maxPointLights,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

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

const gbufferVertexBufferSpec = [
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

const bglObject = device.createBindGroupLayout({
  label: 'object',
  entries: [
    // object uniform
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {
        type: 'uniform',
      },
    },
    // albedo texture
    {
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {
        sampleType: 'float',
      },
    },
    // albedo sampler
    {
      binding: 2,
      visibility: GPUShaderStage.FRAGMENT,
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

const bglGbufferInputs = device.createBindGroupLayout({
  label: 'gbuffer inputs',
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {
        multisampled: true,
        sampleType: 'unfilterable-float',
      },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {
        multisampled: true,
        sampleType: 'unfilterable-float',
      },
    },
    {
      binding: 2,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {
        multisampled: true,
        sampleType: 'uint',
      },
    },
    {
      binding: 3,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {
        multisampled: true,
        sampleType: 'depth',
      },
    },
  ],
});

const bglLight = device.createBindGroupLayout({
  label: 'light',
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: {
        type: 'uniform',
      },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: {
        type: 'read-only-storage',
      },
    },
    {
      binding: 2,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {
        sampleType: 'depth',
        viewDimension: '2d-array',
      },
    },
    {
      binding: 3,
      visibility: GPUShaderStage.FRAGMENT,
      sampler: {
        type: 'comparison',
      },
    },
  ],
});

const bglLightForShadowMap = device.createBindGroupLayout({
  label: 'shadow map light',
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: {
        type: 'uniform',
        hasDynamicOffset: true,
      },
    },
  ],
});

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
  layout: device.createPipelineLayout({
    bindGroupLayouts: [bglObject, bglLightForShadowMap],
  }),
});

const gbufferRenderPipeline = device.createRenderPipeline({
  label: 'gbuffer',
  vertex: {
    module: gbufferVertShaderModule,
    entryPoint: 'main',
    buffers: gbufferVertexBufferSpec,
  },
  fragment: {
    module: gbufferFragShaderModule,
    entryPoint: 'main',
    targets: [
      // albedo
      { format: 'bgra8unorm' },
      // normal
      { format: 'rgba16float' },
      // material
      { format: 'r8uint' },
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
    bindGroupLayouts: [bglObject, bglGlobal],
  }),
});

const deferredRenderPipeline = device.createRenderPipeline({
  label: 'deferred screen',
  vertex: {
    module: deferredVertShaderModule,
    entryPoint: 'main',
  },
  fragment: {
    module: deferredFragShaderModule,
    entryPoint: 'main',
    targets: [
      { format: preferredFormat },
    ],
  },
  primitive: {
    topology: 'triangle-list',
    cullMode: 'back',
  },
  multisample: {
    count: 4,
  },
  layout: device.createPipelineLayout({
    bindGroupLayouts: [bglGlobal, bglGbufferInputs, bglLight],
  }),
});

const boxTexture = await boxTexturePromise;

const bindGroupObjects = gpuObjectBuffers.map(({ uniform }) => {
  return device.createBindGroup({
    layout: bglObject,
    entries: [
      {
        binding: 0,
        resource: uniform,
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

const shadowBindGroupLights = device.createBindGroup({
  layout: bglLightForShadowMap,
  entries: [
    {
      binding: 0,
      resource: {
        buffer: gpuPointLightsData,
        size: 256,
      },
    },
  ],
});

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
  const screen = device.createTexture({
    size: [width, height],
    format: preferredFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    sampleCount: 4,
  });
  const albedo = device.createTexture({
    size: [width, height],
    format: 'bgra8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    sampleCount: 4,
  });
  const normal = device.createTexture({
    size: [width, height],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    sampleCount: 4,
  });
  const material = device.createTexture({
    size: [width, height],
    format: 'r8uint',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    sampleCount: 4,
  });
  const depth = device.createTexture({
    size: [width, height],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    sampleCount: 4,
  });
  const gbuffers = [albedo, normal, material];

  const numShadows = opt?.numShadows ?? 0;
  let shadowDepth: GPUTexture | undefined;
  if (numShadows > 0) {
    shadowDepth = device.createTexture({
      dimension: '2d',
      size: [1024, 1024, numShadows],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }
  return { screen, gbuffers, depth, shadowDepth };
}

const { canvas, context } = await initCanvas();

let currentWidth = canvas.width;
let currentHeight = canvas.height;
let oldTextures: GPUTexture[] = [];
let { screen, gbuffers, depth, shadowDepth } = createTextures(currentWidth, currentHeight, { numShadows: maxPointLights });
if (!shadowDepth) {
  throw new Error();
}

const shadowDepthViews = Array(shadowDepth.depthOrArrayLayers).fill(null).map((_, idx) => {
  return shadowDepth.createView({
    dimension: '2d',
    baseArrayLayer: idx,
  });
});

const gbufferViews = [...gbuffers, depth].map(texture => texture.createView());
let bindGroupGbufferInputs = device.createBindGroup({
  layout: bglGbufferInputs,
  entries: gbufferViews.map((view, idx) => ({
    binding: idx,
    resource: view,
  })),
});

const bindGroupPointLights = device.createBindGroup({
  layout: bglLight,
  entries: [
    {
      binding: 0,
      resource: gpuNumPointLights,
    },
    {
      binding: 1,
      resource: gpuPointLightsData,
    },
    {
      binding: 2,
      resource: shadowDepth.createView({
        dimension: '2d-array',
      }),
    },
    {
      binding: 3,
      resource: device.createSampler({ compare: 'less' }),
    },
  ],
});

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
device.queue.writeBuffer(gpuNumPointLights, 0, new Uint32Array([numPointLights]));

for (let i = 0; i < numPointLights; i++) {
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

  device.queue.writeBuffer(gpuPointLightsData, i * 256, buffer);
}

class TimestampQueryManager {
  public querySet: GPUQuerySet;
  public buffer: GPUBuffer;
  public mappableBuffer: GPUBuffer;

  constructor() {
    this.querySet = device.createQuerySet({
      type: 'timestamp',
      count: numPointLights * 2 + 4,
    });

    this.buffer = device.createBuffer({
      size: this.querySet.count * 8,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });

    this.mappableBuffer = device.createBuffer({
      size: this.buffer.size,
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
      const node = document.createElement('div');
      const elapsedTotalMs = Number(timestamps[timestamps.length - 1] - timestamps[0]) * 1e-6;
      node.textContent = `render total: ${elapsedTotalMs.toFixed(2)} ms`;
      info.appendChild(node);
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

const gbufferPassDescriptor = {
  colorAttachments: gbuffers.map(texture => ({
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: { r: 0, g: 0, b: 0, a: 0 },
    view: texture.createView(),
  })),
  depthStencilAttachment: {
    depthLoadOp: 'clear',
    depthStoreOp: 'store',
    depthClearValue: 1.0,
    view: depth.createView(),
  },
  timestampWrites: undefined as GPURenderPassTimestampWrites | undefined,
} satisfies GPURenderPassDescriptor;

const deferredScreenPassDescriptor = {
  colorAttachments: [
    {
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      view: screen.createView(),
      resolveTarget: undefined as GPUTextureView | undefined,
    },
  ],
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

      oldTextures = [screen, ...gbuffers, depth];
      ({ screen, gbuffers, depth } = createTextures(width, height));
      const gbufferViews = [...gbuffers, depth].map(texture => texture.createView());
      bindGroupGbufferInputs = device.createBindGroup({
        layout: bglGbufferInputs,
        entries: gbufferViews.map((view, idx) => ({
          binding: idx,
          resource: view,
        })),
      });

      gbufferPassDescriptor.colorAttachments = gbuffers.map(texture => ({
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        view: texture.createView(),
      }));
      gbufferPassDescriptor.depthStencilAttachment.view = depth.createView();
      deferredScreenPassDescriptor.colorAttachments[0].view = screen.createView();
    }
  }
});
ro.observe(canvas, { box: 'device-pixel-content-box' });

function createShadowBundle(lightIndex: number): GPURenderBundle {
  const shadowBundleEncoder = device.createRenderBundleEncoder({
    label: `shadow map render bundle for light #${lightIndex}`,
    colorFormats: [],
    depthStencilFormat: 'depth32float',
    stencilReadOnly: true,
  });
  shadowBundleEncoder.setPipeline(shadowPipeline);
  shadowBundleEncoder.setBindGroup(1, shadowBindGroupLights, [lightIndex * 256]);
  for (let i = 0; i < gpuObjectBuffers.length; i++) {
    const { vertices, indices } = gpuObjectBuffers[i].geometry;
    shadowBundleEncoder.setBindGroup(0, bindGroupObjects[i]);
    shadowBundleEncoder.setVertexBuffer(0, vertices);
    shadowBundleEncoder.setIndexBuffer(indices, 'uint16');
    shadowBundleEncoder.drawIndexed(indices.size / 2);
  }
  return shadowBundleEncoder.finish();
}

const shadowRenderBundles = Array(maxPointLights).fill(null).map((_, idx) => createShadowBundle(idx));

const beginTime = performance.now();
function render() {
  canvas.width = currentWidth;
  canvas.height = currentHeight;

  const timeElapsed = (performance.now() - beginTime) / 1000;
  const modelRot = quat.identity();
  const modelRotVal = timeElapsed / 3;
  quat.rotateX(modelRot, Math.cos(modelRotVal) * Math.PI / 2, modelRot);
  quat.rotateY(modelRot, Math.sin(modelRotVal) * Math.PI / 2, modelRot);
  const objectMat = mat4.fromQuat(modelRot);
  const floorObjectMat = mat4.multiply(mat4.translation([0, -4, 0]), mat4.scaling([5, 5, 5]));

  const viewMat = mat4.lookAt([0, 6, 5], [0, 0, 0], [0, 1, 0]);
  const projMat = mat4.perspective(Math.PI / 3, (canvas.width / canvas.height), 0.5, 50);
  const viewProjMat = mat4.multiply(projMat, viewMat);
  const viewProjMatInv = mat4.inverse(viewProjMat);

  device.queue.writeBuffer(
    gpuObjectBuffers[0].uniform,
    0,
    objectMat.buffer,
    objectMat.byteOffset,
    objectMat.byteLength,
  );
  device.queue.writeBuffer(
    gpuObjectBuffers[1].uniform,
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
    viewProjMat.buffer,
    viewProjMat.byteOffset,
    viewProjMat.byteLength,
  );
  device.queue.writeBuffer(
    gpuUniformGlobalData,
    128,
    viewProjMatInv.buffer,
    viewProjMatInv.byteOffset,
    viewProjMatInv.byteLength,
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
    if (timestampManager) {
      gbufferPassDescriptor.timestampWrites = {
        querySet: timestampManager.querySet,
        beginningOfPassWriteIndex: timestampQueryIndexBase,
        endOfPassWriteIndex: timestampQueryIndexBase + 1,
      };
    }

    const passEncoder = commandEncoder.beginRenderPass(gbufferPassDescriptor);
    passEncoder.setPipeline(gbufferRenderPipeline);
    passEncoder.setBindGroup(1, bindGroupGlobal);

    for (let i = 0; i < gpuObjectBuffers.length; i++) {
      const { vertices, indices } = gpuObjectBuffers[i].geometry;
      passEncoder.setBindGroup(0, bindGroupObjects[i]);
      passEncoder.setVertexBuffer(0, vertices);
      passEncoder.setIndexBuffer(indices, 'uint16');
      passEncoder.drawIndexed(indices.size / 2);
    }

    passEncoder.end();
  }

  {
    deferredScreenPassDescriptor.colorAttachments[0].resolveTarget = context.getCurrentTexture().createView();
    if (timestampManager) {
      deferredScreenPassDescriptor.timestampWrites = {
        querySet: timestampManager.querySet,
        beginningOfPassWriteIndex: timestampQueryIndexBase + 2,
        endOfPassWriteIndex: timestampQueryIndexBase + 3,
      };
    }

    const passEncoder = commandEncoder.beginRenderPass(deferredScreenPassDescriptor);
    passEncoder.setPipeline(deferredRenderPipeline);
    passEncoder.setBindGroup(0, bindGroupGlobal);
    passEncoder.setBindGroup(1, bindGroupGbufferInputs);
    passEncoder.setBindGroup(2, bindGroupPointLights);
    passEncoder.draw(6);
    passEncoder.end();
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
