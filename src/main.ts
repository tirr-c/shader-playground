import { mat4, quat, vec3 } from 'wgpu-matrix';

import { createBindGroupLayouts, loadShaders } from './shaders.js';
import { box, floor } from './geometry.js';
import { TimestampQueryManager } from './timestamp.js';

const boxTextureUrl = new URL('./assets/box.png', import.meta.url);

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

const numMultisamples = 4;

// Shaders
const shaderModules = await loadShaders(device);

// Geometry data
const boxTexturePromise = loadTexture(device);

export function createObjectUniformBuffer(device: GPUDevice) {
  return device.createBuffer({
    // 4x4 matrix of f32
    size: 4 * 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

const gpuObjectBuffers = [
  {
    geometry: box.createGeometryBuffers(device),
    uniform: createObjectUniformBuffer(device),
  },
  {
    geometry: floor.createGeometryBuffers(device),
    uniform: createObjectUniformBuffer(device),
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

const bgl = createBindGroupLayouts(device);

const shadowPipeline = device.createRenderPipeline({
  label: 'shadow',
  vertex: {
    module: shaderModules.shadow,
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
    bindGroupLayouts: [bgl.object, bgl.lightForShadowMap],
  }),
});

const gbufferRenderPipeline = device.createRenderPipeline({
  label: 'gbuffer',
  vertex: {
    module: shaderModules.gbufferVert,
    entryPoint: 'main',
    buffers: gbufferVertexBufferSpec,
  },
  fragment: {
    module: shaderModules.gbufferFrag,
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
    count: numMultisamples,
  },
  layout: device.createPipelineLayout({
    bindGroupLayouts: [bgl.object, bgl.global],
  }),
});

const deferredRenderPipeline = device.createRenderPipeline({
  label: 'deferred screen',
  vertex: {
    module: shaderModules.deferredVert,
    entryPoint: 'main',
  },
  fragment: {
    module: shaderModules.deferredFrag,
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
    count: numMultisamples,
  },
  layout: device.createPipelineLayout({
    bindGroupLayouts: [bgl.global, bgl.gbufferInputs, bgl.light],
  }),
});

const boxTexture = await boxTexturePromise;

const bindGroupObjects = gpuObjectBuffers.map(({ uniform }) => {
  return device.createBindGroup({
    layout: bgl.object,
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
  layout: bgl.lightForShadowMap,
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
  layout: bgl.global,
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
    sampleCount: numMultisamples,
  });
  const albedo = device.createTexture({
    size: [width, height],
    format: 'bgra8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    sampleCount: numMultisamples,
  });
  const normal = device.createTexture({
    size: [width, height],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    sampleCount: numMultisamples,
  });
  const material = device.createTexture({
    size: [width, height],
    format: 'r8uint',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    sampleCount: numMultisamples,
  });
  const depth = device.createTexture({
    size: [width, height],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    sampleCount: numMultisamples,
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
  layout: bgl.gbufferInputs,
  entries: gbufferViews.map((view, idx) => ({
    binding: idx,
    resource: view,
  })),
});

const bindGroupPointLights = device.createBindGroup({
  layout: bgl.light,
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

const infoNode = document.getElementById('info');
let timestampManager: TimestampQueryManager | undefined;
if (device.features.has('timestamp-query')) {
  timestampManager = new TimestampQueryManager(device);
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
        layout: bgl.gbufferInputs,
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

  const renderBeginTime = performance.now();

  const timeElapsed = (renderBeginTime - beginTime) / 1000;
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
    shadowPassDescriptor.timestampWrites = undefined;
    if (timestampManager && i === 0) {
      shadowPassDescriptor.timestampWrites = {
        querySet: timestampManager.querySet,
        beginningOfPassWriteIndex: 0,
      };
    }

    const passEncoder = commandEncoder.beginRenderPass(shadowPassDescriptor);
    passEncoder.executeBundles([shadowRenderBundles[i]]);
    passEncoder.end();
  }

  {
    gbufferPassDescriptor.timestampWrites = undefined;

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
    deferredScreenPassDescriptor.timestampWrites = undefined;
    if (timestampManager) {
      deferredScreenPassDescriptor.timestampWrites = {
        querySet: timestampManager.querySet,
        endOfPassWriteIndex: 1,
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

  const elapsedHostMs = performance.now() - renderBeginTime;
  timestampManager?.setElapsedHost(elapsedHostMs);

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
