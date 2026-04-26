const shaderUrls = {
  common: new URL('./assets/shaders/common.wgsl', import.meta.url),
  shadow: new URL('./assets/shaders/shadow.wgsl', import.meta.url),
  gbufferVert: new URL('./assets/shaders/gbuffer-vert.wgsl', import.meta.url),
  gbufferFrag: new URL('./assets/shaders/gbuffer-frag.wgsl', import.meta.url),
  deferredVert: new URL('./assets/shaders/deferred-vert.wgsl', import.meta.url),
  deferredFrag: new URL('./assets/shaders/deferred-frag.wgsl', import.meta.url),
};

export async function loadShaders(device: GPUDevice) {
  const shaderEntries = await Promise.all(
    Object.entries(shaderUrls).map(async ([key, url]) => {
      const resp = await fetch(url);
      return [key, await resp.text()] as const;
    }),
  );
  const shaders = Object.fromEntries(shaderEntries);

  return {
    shadow: device.createShaderModule({
      label: 'shadow',
      code: shaders.common + shaders.shadow,
    }),
    gbufferVert: device.createShaderModule({
      label: 'shadow',
      code: shaders.common + shaders.gbufferVert,
    }),
    gbufferFrag: device.createShaderModule({
      label: 'shadow',
      code: shaders.common + shaders.gbufferFrag,
    }),
    deferredVert: device.createShaderModule({
      label: 'shadow',
      code: shaders.common + shaders.deferredVert,
    }),
    deferredFrag: device.createShaderModule({
      label: 'shadow',
      code: shaders.common + shaders.deferredFrag,
    }),
  };
}

export function createBindGroupLayouts(device: GPUDevice) {
  return {
    object: device.createBindGroupLayout({
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
    }),

    global: device.createBindGroupLayout({
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
    }),

    gbufferInputs: device.createBindGroupLayout({
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
            sampleType: 'depth',
          },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            multisampled: true,
            sampleType: 'uint',
          },
        },
      ],
    }),

    light: device.createBindGroupLayout({
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
    }),

    lightForShadowMap: device.createBindGroupLayout({
      label: 'shadow map light',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: {
            type: 'uniform',
          },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: {
            type: 'read-only-storage',
          },
        },
      ],
    }),
  };
}
