import { mat4, quat, vec4 } from 'wgpu-matrix';

const shaderUrl = new URL('./shaders.wgsl', import.meta.url);
const boxTextureUrl = new URL('./box.png', import.meta.url);

const hostVertexData = new Float32Array([
  // position, n, uv
  // front
  -1, 1, 1, 1,    0, 0, 1, 0,   0, 0,
  1, 1, 1, 1,     0, 0, 1, 0,   1, 0,
  -1, -1, 1, 1,   0, 0, 1, 0,   0, 1,
  1, -1, 1, 1,    0, 0, 1, 0,   1, 1,
  // right
  1, 1, 1, 1,     1, 0, 0, 0,   0, 0,
  1, 1, -1, 1,    1, 0, 0, 0,   1, 0,
  1, -1, 1, 1,    1, 0, 0, 0,   0, 1,
  1, -1, -1, 1,   1, 0, 0, 0,   1, 1,
  // back
  1, 1, -1, 1,    0, 0, -1, 0,  0, 0,
  -1, 1, -1, 1,   0, 0, -1, 0,  1, 0,
  1, -1, -1, 1,   0, 0, -1, 0,  0, 1,
  -1, -1, -1, 1,  0, 0, -1, 0,  1, 1,
  // left
  -1, 1, -1, 1,   -1, 0, 0, 0,  0, 0,
  -1, 1, 1, 1,    -1, 0, 0, 0,  1, 0,
  -1, -1, -1, 1,  -1, 0, 0, 0,  0, 1,
  -1, -1, 1, 1,   -1, 0, 0, 0,  1, 1,
  // top
  -1, 1, -1, 1,   0, 1, 0, 0,   0, 0,
  1, 1, -1, 1,    0, 1, 0, 0,   1, 0,
  -1, 1, 1, 1,    0, 1, 0, 0,   0, 1,
  1, 1, 1, 1,     0, 1, 0, 0,   1, 1,
  // bottom
  -1, -1, 1, 1,   0, -1, 0, 0,  0, 0,
  1, -1, 1, 1,    0, -1, 0, 0,  1, 0,
  -1, -1, -1, 1,  0, -1, 0, 0,  0, 1,
  1, -1, -1, 1,   0, -1, 0, 0,  1, 1,
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

async function initDevice() {
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

  return { device, canvas, context, preferredFormat };
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

async function init() {
  const { device, canvas, context, preferredFormat } = await initDevice();

  const shadersResp = await fetch(shaderUrl);
  const shaders = await shadersResp.text();
  const shaderModule = device.createShaderModule({ code: shaders });

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

  const gpuUniformObjectsData = device.createBuffer({
    // 4x4 matrix of f32
    size: 4 * 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const gpuUniformGlobalData = device.createBuffer({
    // 4x4 matrix of f32 x3 (view_mat, proj_mat, proj_mat_inv)
    size: 4 * 4 * 4 * 3,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const gpuUniformLightsData = device.createBuffer({
    // vector of f32 + one f32, aligned to 16
    size: 4 * 4 + 4 + 12,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

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
          format: 'float32x2',
        },
      ],
      arrayStride: 4 * (4 + 4 + 2),
      stepMode: 'vertex',
    },
  ] satisfies GPUVertexBufferLayout[];

  const pipelineDescriptor = {
    vertex: {
      module: shaderModule,
      entryPoint: 'vertex_main',
      buffers: vertexBufferSpec,
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragment_main',
      targets: [
        {
          format: navigator.gpu.getPreferredCanvasFormat(),
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
    layout: 'auto',
  } satisfies GPURenderPipelineDescriptor;
  const renderPipeline = device.createRenderPipeline(pipelineDescriptor);

  const bindGroupObjects = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: gpuUniformObjectsData,
      },
      {
        binding: 1,
        resource: device.createSampler({
          magFilter: 'linear',
          minFilter: 'linear',
        }),
      },
      {
        binding: 2,
        resource: await boxTexturePromise,
      },
    ],
  });

  const bindGroupGlobal = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(1),
    entries: [
      {
        binding: 0,
        resource: gpuUniformGlobalData,
      },
      {
        binding: 1,
        resource: gpuUniformLightsData,
      },
    ],
  });

  function createTextures(width: number, height: number) {
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
    return { texture, depth };
  }

  let currentWidth = canvas.width;
  let currentHeight = canvas.height;
  let oldTextures: GPUTexture[] = [];
  let { texture, depth } = createTextures(currentWidth, currentHeight);

  const renderPassDescriptor = {
    colorAttachments: [
      {
        loadOp: 'clear',
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

  const beginTime = performance.now();
  function render() {
    canvas.width = currentWidth;
    canvas.height = currentHeight;

    const timeElapsed = (performance.now() - beginTime) / 1000 / 1.5;
    const modelRot = quat.identity();
    quat.rotateX(modelRot, Math.cos(timeElapsed) * Math.PI / 2, modelRot);
    quat.rotateY(modelRot, Math.sin(timeElapsed) * Math.PI / 2, modelRot);
    const viewMat = mat4.lookAt([3, 3, 3], [0, 0, 0], [0, 1, 0]);
    const projMat = mat4.perspective(Math.PI / 3, (canvas.width / canvas.height), 0.5, 10);
    const projMatInv = mat4.inverse(projMat);
    const objectMat = mat4.fromQuat(modelRot);

    const lightPosAndIntensity = new Float32Array([1, 5, 1, 1, 40, 0.0]);

    device.queue.writeBuffer(
      gpuUniformObjectsData,
      0,
      objectMat.buffer,
      objectMat.byteOffset,
      objectMat.byteLength,
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
    device.queue.writeBuffer(
      gpuUniformGlobalData,
      128,
      projMatInv.buffer,
      projMatInv.byteOffset,
      projMatInv.byteLength,
    );
    device.queue.writeBuffer(
      gpuUniformLightsData,
      0,
      lightPosAndIntensity.buffer,
      lightPosAndIntensity.byteOffset,
      lightPosAndIntensity.byteLength,
    );

    renderPassDescriptor.colorAttachments[0].resolveTarget = context.getCurrentTexture().createView();
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(renderPipeline);
    passEncoder.setBindGroup(0, bindGroupObjects);
    passEncoder.setBindGroup(1, bindGroupGlobal);
    passEncoder.setVertexBuffer(0, gpuVertexData);
    passEncoder.setIndexBuffer(gpuIndexData, 'uint16');
    passEncoder.drawIndexed(36);
    passEncoder.end();

    const commandBuffer = commandEncoder.finish();
    device.queue.submit([commandBuffer]);

    for (const t of oldTextures) {
      t.destroy();
    }
    oldTextures = [];

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

document.addEventListener('DOMContentLoaded', init);
