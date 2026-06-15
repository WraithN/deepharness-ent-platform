import { useCallback, useEffect, useMemo, useState } from 'react'
import { type FileError, type FileRejection, useDropzone } from 'react-dropzone'

interface FileWithPreview extends File {
  preview?: string
  errors: readonly FileError[]
}

// 上传 API 的占位配置项。
// 后续接入真实后端文件上传服务时，可在此扩展 headers、formData 构建器等参数。
type UseFileUploadOptions = {
  /**
   * 上传目标路径或 bucket 名称（占位）。
   */
  bucketName: string
  /**
   * 文件在目标路径中的子目录（占位）。
   */
  path?: string
  /**
   * 允许的 MIME 类型列表，例如 image/png、text/html。
   * 默认允许所有类型。
   */
  allowedMimeTypes?: string[]
  /**
   * 单个文件最大字节数。
   */
  maxFileSize?: number
  /**
   * 每次最多允许上传的文件数。
   */
  maxFiles?: number
  /**
   * 是否覆盖同名文件（占位）。
   */
  upsert?: boolean
}

type UseFileUploadReturn = ReturnType<typeof useFileUpload>

const DEFAULT_MAX_FILE_SIZE = Number.POSITIVE_INFINITY
const DEFAULT_MAX_FILES = 1

/**
 * useFileUpload 是基于 react-dropzone 的通用文件选择/上传 hook。
 *
 * 说明：
 * - 当前为 MySQL 迁移后的占位实现，移除了对 Supabase 的强依赖。
 * - 文件实际上传逻辑目前为模拟：onUpload 会标记所有文件为成功，
 *   后续应替换为调用后端上传 API 的真实实现。
 */
const useFileUpload = (options: UseFileUploadOptions) => {
  const {
    bucketName,
    path,
    allowedMimeTypes = [],
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    maxFiles = DEFAULT_MAX_FILES,
    upsert = false,
  } = options

  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [errors, setErrors] = useState<{ name: string; message: string }[]>([])
  const [successes, setSuccesses] = useState<string[]>([])

  const isSuccess = useMemo(() => {
    if (errors.length === 0 && successes.length === 0) {
      return false
    }
    if (errors.length === 0 && successes.length === files.length) {
      return true
    }
    return false
  }, [errors.length, successes.length, files.length])

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      const validFiles = acceptedFiles
        .filter((file) => !files.find((x) => x.name === file.name))
        .map((file) => {
          ;(file as FileWithPreview).preview = URL.createObjectURL(file)
          ;(file as FileWithPreview).errors = []
          return file as FileWithPreview
        })

      const invalidFiles = fileRejections.map(({ file, errors }) => {
        ;(file as FileWithPreview).preview = URL.createObjectURL(file)
        ;(file as FileWithPreview).errors = errors
        return file as FileWithPreview
      })

      const newFiles = [...files, ...validFiles, ...invalidFiles]

      setFiles(newFiles)
    },
    [files, setFiles]
  )

  const accept = useMemo(() => {
    return allowedMimeTypes.reduce<Record<string, string[]>>((acc, type) => {
      acc[type] = []
      return acc
    }, {})
  }, [allowedMimeTypes])

  const dropzoneProps = useDropzone({
    onDrop,
    noClick: true,
    accept,
    maxSize: maxFileSize,
    maxFiles,
    multiple: maxFiles !== 1,
  })

  const onUpload = useCallback(async () => {
    setLoading(true)

    // 仅重试之前上传失败的文件，或尚未成功上传的文件。
    const filesWithErrors = errors.map((x) => x.name)
    const filesToUpload =
      filesWithErrors.length > 0
        ? [
            ...files.filter((f) => filesWithErrors.includes(f.name)),
            ...files.filter((f) => !successes.includes(f.name)),
          ]
        : files

    // 占位上传逻辑：后续应替换为 fetch('/api/v1/upload') 或类似真实请求。
    // 当前按顺序标记每个文件为成功，便于 UI 保持正常状态流转。
    const responseErrors: { name: string; message: string }[] = []
    for (const file of filesToUpload) {
      try {
        // eslint-disable-next-line no-console
        console.log(
          `[placeholder upload] bucket=${bucketName}, path=${path ?? ''}, file=${file.name}, upsert=${upsert}`
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed'
        responseErrors.push({ name: file.name, message })
      }
    }

    setErrors(responseErrors)

    const responseSuccesses = filesToUpload
      .filter((f) => !responseErrors.some((e) => e.name === f.name))
      .map((f) => f.name)
    const newSuccesses = Array.from(new Set([...successes, ...responseSuccesses]))
    setSuccesses(newSuccesses)

    setLoading(false)
  }, [files, path, bucketName, errors, successes, upsert])

  useEffect(() => {
    if (files.length === 0) {
      setErrors([])
    }

    // 当文件数量未超过 maxFiles 时，移除每个文件上的 'too-many-files' 错误。
    if (files.length <= maxFiles) {
      let changed = false
      const newFiles = files.map((file) => {
        if (file.errors.some((e) => e.code === 'too-many-files')) {
          file.errors = file.errors.filter((e) => e.code !== 'too-many-files')
          changed = true
        }
        return file
      })
      if (changed) {
        setFiles(newFiles)
      }
    }
  }, [files.length, setFiles, maxFiles])

  return {
    files,
    setFiles,
    successes,
    isSuccess,
    loading,
    errors,
    setErrors,
    onUpload,
    maxFileSize,
    maxFiles,
    allowedMimeTypes,
    ...dropzoneProps,
  }
}

export { useFileUpload, type UseFileUploadOptions, type UseFileUploadReturn }
